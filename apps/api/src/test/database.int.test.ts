import { afterAll, describe, expect, it } from 'vitest';
import { createTestPool } from './test-db.js';

/**
 * Smoke test proving the integration-test wiring works (local Docker and CI service).
 * Real repository/API tests are added from issue #4 onwards.
 */
describe('test database', () => {
  const pool = createTestPool();
  afterAll(() => pool.end());

  it('is reachable and is the dedicated _test database', async () => {
    const { rows } = await pool.query<{ db: string }>('select current_database() as db');
    expect(rows[0]?.db).toMatch(/_test$/);
  });

  it('runs PostgreSQL 17, matching RDS', async () => {
    const { rows } = await pool.query<{ v: string }>("select current_setting('server_version_num') as v");
    expect(Number(rows[0]?.v)).toBeGreaterThanOrEqual(170000);
    expect(Number(rows[0]?.v)).toBeLessThan(180000);
  });

  it('rolls back a transaction cleanly (pattern used by later tests)', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('create temp table ci_probe (id int) on commit drop');
      await client.query('insert into ci_probe values (1), (2)');
      const { rows } = await client.query<{ n: string }>('select count(*) as n from ci_probe');
      expect(Number(rows[0]?.n)).toBe(2);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
