import pg from 'pg';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://mom:mom@localhost:5432/mom_test';

/**
 * Safety net for integration tests: they create and delete data, so they may only
 * ever run against a database whose name ends in `_test` — never dev or prod data.
 */
export function assertTestDatabaseUrl(url: string): string {
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${dbName}": its name must end with "_test"`);
  }
  return url;
}

export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  return assertTestDatabaseUrl(env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
}

export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
}
