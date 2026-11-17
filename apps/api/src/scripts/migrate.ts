// `npm run db:migrate` — applies pending migrations to DATABASE_URL.
import { z } from 'zod';
import { runMigrations } from '../db/migrate.js';

const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
if (!url.success) {
  console.error('✘ DATABASE_URL is missing or not a postgres:// URL (see apps/api/.env)');
  process.exit(1);
}

const started = Date.now();
await runMigrations(url.data);
console.log(`✔ Database migrated (${Date.now() - started} ms)`);
