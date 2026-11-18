import { calcFees } from '@mom/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createDb } from '../../db/client.js';
import {
  menuCategories,
  menuItems,
  orderItems,
  orders,
  platformSettings,
  stalls,
  tokenCounters,
  users,
} from '../../db/schema/index.js';
import { testEnv } from '../../test/test-app.js';
import { testDatabaseUrl } from '../../test/test-db.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken } from '../auth/tokens.js';

/**
 * Real concurrency: a pool of 10 connections, committed data, 50 orders at the same instant.
 * (The rollback harness uses one connection, which would serialise everything and prove nothing.)
 */
const PARALLEL = 50;
const { db, pool } = createDb(testDatabaseUrl(), { max: 10 });
let app: FastifyInstance;
let stallId: string;
let itemId: string;
const userIds: string[] = [];
const cookies: Array<Record<string, string>> = [];
const expectedTotal = calcFees(6000, 'cash', { platformFeeBps: 100, cashFeeBps: 500 }).totalPaise;

beforeAll(async () => {
  await db.insert(platformSettings).values({
    platformFeeBps: 100,
    cashFeeBps: 500,
    maxOpenCashOrders: 2,
    cashStrikeLimit: 3,
    orderExpiryMinutes: 15,
    congestionLowMaxMinutes: 10,
    congestionModerateMaxMinutes: 20,
  });
  const [stall] = await db
    .insert(stalls)
    .values({ slug: `rush-${Date.now()}`, name: 'Lunch Rush', status: 'active', isOpenOverride: true })
    .returning();
  stallId = stall!.id;
  const [cat] = await db.insert(menuCategories).values({ stallId, name: 'Meals' }).returning();
  const [item] = await db
    .insert(menuItems)
    .values({ stallId, categoryId: cat!.id, name: 'Thali', pricePaise: 6000, isVeg: true })
    .returning();
  itemId = item!.id;
  const created = await db
    .insert(users)
    .values(
      Array.from({ length: PARALLEL }, (_, i) => ({
        phone: `+9194${String(Date.now()).slice(-6)}${String(i).padStart(2, '0')}`,
        name: `Student ${i}`,
      })),
    )
    .returning({ id: users.id });
  for (const u of created) {
    userIds.push(u.id);
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u.id, role: 'student' }, 900);
    cookies.push({ [ACCESS_COOKIE]: token });
  }
  app = await buildApp({
    env: testEnv({ RATE_LIMIT_PER_MINUTE: '10000' }),
    db,
    logger: false,
    stallsCacheTtlMs: 0,
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  const ids = (await db.select({ id: orders.id }).from(orders).where(eq(orders.stallId, stallId))).map(
    (o) => o.id,
  );
  if (ids.length) await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
  await db.delete(orders).where(eq(orders.stallId, stallId));
  await db.delete(tokenCounters).where(eq(tokenCounters.stallId, stallId));
  await db.delete(menuItems).where(eq(menuItems.stallId, stallId));
  await db.delete(menuCategories).where(eq(menuCategories.stallId, stallId));
  await db.delete(stalls).where(eq(stalls.id, stallId));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

const place = (i: number, key = `rush-${i}-${stallId}`) =>
  app.inject({
    method: 'POST',
    url: '/v1/orders',
    cookies: cookies[i],
    headers: { 'idempotency-key': key },
    payload: {
      stallId,
      items: [{ itemId, quantity: 1 }],
      paymentMethod: 'cash',
      expectedTotalPaise: expectedTotal,
    },
  });

describe('lunch rush', () => {
  it(`${PARALLEL} parallel cash orders get tokens 1…${PARALLEL}: no gaps, no duplicates`, async () => {
    const results = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => place(i)));
    const failed = results.filter((r) => r.statusCode !== 201).map((r) => `${r.statusCode} ${r.body}`);
    expect(failed, failed.slice(0, 3).join('\n')).toEqual([]);
    const tokens = results.map((r) => r.json().order.tokenNo as number).sort((a, b) => a - b);
    expect(tokens).toEqual(Array.from({ length: PARALLEL }, (_, i) => i + 1));
    const [counter] = await db.select().from(tokenCounters).where(eq(tokenCounters.stallId, stallId));
    expect(counter!.lastToken).toBe(PARALLEL);
  });

  it('10 simultaneous retries with the same key create exactly one order', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => place(0, `same-key-${stallId}`)));
    const bad = results.filter((r) => r.statusCode >= 300).map((r) => `${r.statusCode} ${r.body}`);
    expect(bad, bad.slice(0, 2).join('\n')).toEqual([]);
    const ids = new Set(results.map((r) => r.json().order.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(9);
  });
});
