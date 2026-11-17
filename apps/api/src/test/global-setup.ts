import pg from 'pg';
import { runMigrations } from '../db/migrate.js';
import { testDatabaseUrl } from './test-db.js';

/**
 * Runs once before the integration tests: wipes the *_test database and applies
 * every migration from scratch, so tests always see exactly the committed schema.
 */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl(); // throws unless the database name ends in _test
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists drizzle cascade');
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
