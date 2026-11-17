import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDb>['db'];

/**
 * Creates the connection pool + Drizzle instance. One per process.
 * `casing: 'snake_case'` maps camelCase fields in TypeScript to snake_case columns.
 */
export function createDb(databaseUrl: string, options: { max?: number; applicationName?: string } = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName ?? 'mom-api',
  });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}

export { schema };
