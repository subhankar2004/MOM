import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createDb } from '../../db/client.js';
import { orders, platformSettings, stalls, users } from '../../db/schema/index.js';
import { testEnv } from '../../test/test-app.js';
import { testDatabaseUrl } from '../../test/test-db.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken } from '../auth/tokens.js';

/**
 * End to end through Postgres: an UPDATE on `orders` → trigger → NOTIFY → EventHub → SSE.
 * Needs committed data and a real listening port (inject() can't stream).
 */
const { db, pool } = createDb(testDatabaseUrl(), { max: 4 });
let app: FastifyInstance;
let base: string;
let stallId: string;
const userIds: string[] = [];
let orderId: string;
let otherOrderId: string;
let cookie: string;
let settingsId: number;

beforeAll(async () => {
  const [settings] = await db
    .insert(platformSettings)
    .values({
      platformFeeBps: 100,
      cashFeeBps: 500,
      maxOpenCashOrders: 2,
      cashStrikeLimit: 3,
      orderExpiryMinutes: 15,
      congestionLowMaxMinutes: 10,
      congestionModerateMaxMinutes: 20,
    })
    .returning();
  const [stall] = await db
    .insert(stalls)
    .values({ slug: `live-${Date.now()}`, name: 'Live Stall', status: 'active' })
    .returning();
  stallId = stall!.id;
  settingsId = settings!.id;
  const tail = String(Date.now()).slice(-7);
  const [me, other] = await db
    .insert(users)
    .values([
      { phone: `+91951${tail}`, name: 'Me' },
      { phone: `+91952${tail}`, name: 'Other' },
    ])
    .returning();
  userIds.push(me!.id, other!.id);
  const base0 = {
    stallId,
    status: 'placed' as const,
    paymentMethod: 'cash' as const,
    paymentStatus: 'due' as const,
    subtotalPaise: 6000,
    platformFeePaise: 60,
    cashFeePaise: 300,
    totalPaise: 6360,
    platformFeeBps: 100,
    cashFeeBps: 500,
    pickupCode: '1234',
    settingsId: settings!.id,
    tokenDay: '2026-11-18',
  };
  const [mine, theirs] = await db
    .insert(orders)
    .values([
      { ...base0, userId: me!.id, tokenNo: 1, idempotencyKey: `live-a-${tail}` },
      { ...base0, userId: other!.id, tokenNo: 2, idempotencyKey: `live-b-${tail}` },
    ])
    .returning();
  orderId = mine!.id;
  otherOrderId = theirs!.id;
  const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: me!.id, role: 'student' }, 900);
  cookie = `${ACCESS_COOKIE}=${token}`;

  app = await buildApp({ env: testEnv(), db, logger: false, stallsCacheTtlMs: 0 });
  await app.events.connect(testDatabaseUrl());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await db.delete(orders).where(eq(orders.stallId, stallId));
  await db.delete(stalls).where(eq(stalls.id, stallId));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.delete(platformSettings).where(eq(platformSettings.id, settingsId));
  await pool.end();
});

/** Opens the stream and returns a reader of parsed SSE frames. */
async function openStream(headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/v1/orders/events`, {
    headers: { cookie, ...headers },
    signal: ctrl.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames: Array<{ id?: string; event?: string; data?: string }> = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const f: Record<string, string> = {};
          for (const line of raw.split('\n')) {
            const m = /^(\w+): ?(.*)$/.exec(line);
            if (m) f[m[1]!] = m[2]!;
          }
          frames.push(f);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const waitFor = async (pred: (f: (typeof frames)[number]) => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = frames.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no matching frame within ${ms} ms; got ${JSON.stringify(frames)}`);
  };
  return { res, frames, waitFor, close: () => (ctrl.abort(), pump) };
}

describe('GET /v1/orders/events', () => {
  it('requires sign-in', async () => {
    expect((await fetch(`${base}/v1/orders/events`)).status).toBe(401);
  });

  it('a status change in the database reaches the student within 2 s — and only theirs', async () => {
    const s = await openStream();
    expect(s.res.headers.get('content-type')).toContain('text/event-stream');
    await s.waitFor((f) => f.event === 'ready');
    await db.update(orders).set({ status: 'preparing' }).where(eq(orders.id, otherOrderId));
    await db.update(orders).set({ status: 'ready' }).where(eq(orders.id, orderId));
    const f = await s.waitFor((x) => x.event === 'order');
    expect(JSON.parse(f.data!)).toMatchObject({ orderId, status: 'ready', tokenNo: 1 });
    expect(s.frames.filter((x) => x.event === 'order')).toHaveLength(1);
    await s.close();
  });

  it('reconnecting with Last-Event-ID replays what was missed; an unknown id asks for a resync', async () => {
    const first = await openStream();
    await first.waitFor((f) => f.event === 'ready');
    await db.update(orders).set({ status: 'preparing' }).where(eq(orders.id, orderId));
    const seen = await first.waitFor((f) => f.event === 'order' && f.data!.includes('"preparing"'));
    await first.close();

    await db.update(orders).set({ status: 'ready' }).where(eq(orders.id, orderId));
    await new Promise((r) => setTimeout(r, 300)); // let the notification arrive while "offline"
    const again = await openStream({ 'last-event-id': seen.id! });
    const missed = await again.waitFor((f) => f.event === 'order');
    expect(JSON.parse(missed.data!)).toMatchObject({ status: 'ready' });
    await again.close();

    const lost = await openStream({ 'last-event-id': 'nope' });
    await lost.waitFor((f) => f.event === 'resync');
    await lost.close();
  });
});
