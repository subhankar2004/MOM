import type pg from 'pg';
import { expect } from 'vitest';

/**
 * Runs a statement that MUST fail, inside a savepoint so the surrounding test
 * transaction stays usable, and checks which constraint stopped it.
 */
export async function expectDbError(
  client: pg.PoolClient,
  query: string,
  params: unknown[],
  expected: { code: string; constraint?: string },
): Promise<void> {
  await client.query('savepoint expect_error');
  let error: (Error & { code?: string; constraint?: string }) | undefined;
  try {
    await client.query(query, params);
  } catch (err) {
    error = err as typeof error;
  }
  await client.query('rollback to savepoint expect_error');
  expect(error, `expected "${query}" to fail`).toBeDefined();
  expect(error?.code).toBe(expected.code);
  if (expected.constraint) expect(error?.constraint).toBe(expected.constraint);
}

/** Postgres SQLSTATE codes used in tests. */
export const PG = {
  checkViolation: '23514',
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  notNullViolation: '23502',
  insufficientPrivilege: '42501',
} as const;
