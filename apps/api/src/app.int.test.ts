import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { stalls } from './db/schema/index.js';
import { createTestApp, type TestApp } from './test/test-app.js';
import { createTestPool } from './test/test-db.js';

/** The API against the real mom_test database, using the rollback harness. */
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('API with a real database', () => {
  it('GET /ready → 200 when Postgres is up', async () => {
    t = await createTestApp();
    const res = await t.app.inject('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('harness: data written during a test is visible to the app, then rolled back', async () => {
    t = await createTestApp();
    await t.db.insert(stalls).values({ slug: 'harness-probe', name: 'Harness Probe' });
    const inside = await t.app.db.select().from(stalls).where(eq(stalls.slug, 'harness-probe'));
    expect(inside).toHaveLength(1);

    // A nested transaction inside the app becomes a savepoint and can roll back on its own.
    await t.db
      .transaction(async (inner) => {
        await inner.update(stalls).set({ name: 'Changed' }).where(eq(stalls.slug, 'harness-probe'));
        inner.rollback();
      })
      .catch(() => {});
    const [after] = await t.db
      .select({ name: stalls.name })
      .from(stalls)
      .where(eq(stalls.slug, 'harness-probe'));
    expect(after?.name).toBe('Harness Probe');

    await t.close();
    t = undefined;

    const pool = createTestPool();
    try {
      const { rows } = await pool.query(`select 1 from stalls where slug = 'harness-probe'`);
      expect(rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});
