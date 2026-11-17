import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/** apps/api/drizzle when running from source; the Docker image sets MIGRATIONS_DIR. */
export const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies all pending SQL migrations in ./drizzle, in order, inside a transaction. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl, { max: 1, applicationName: 'mom-migrate' });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
