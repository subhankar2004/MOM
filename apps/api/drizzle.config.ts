import { defineConfig } from 'drizzle-kit';

// Used by drizzle-kit to generate SQL migrations from src/db/schema.
// Migrations are applied by our own runner (src/db/migrate.ts), never by `drizzle-kit push`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://mom:mom@localhost:5432/mom',
  },
});
