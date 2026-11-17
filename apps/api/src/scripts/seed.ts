// `npm run db:seed` — default settings, super admins (SUPER_ADMIN_PHONES) and demo stalls.
import { EnvValidationError, loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { seed } from '../db/seed/seed.js';

let env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
  throw err;
}

if (env.NODE_ENV === 'production') {
  console.error('✘ Refusing to seed demo data into production.');
  process.exit(1);
}

const { db, pool } = createDb(env.DATABASE_URL, { max: 1, applicationName: 'mom-seed' });
try {
  const r = await seed(db, { superAdminPhones: env.SUPER_ADMIN_PHONES, demoStalls: true });
  console.log(`✔ Seed complete
  settings:     ${r.settingsCreated ? 'default fees created (UPI 1%, cash 1% + 5%)' : 'already present — unchanged'}
  super admins: ${r.superAdmins || 'none (set SUPER_ADMIN_PHONES in apps/api/.env)'}
  demo stalls:  ${r.stallsCreated.length ? `created ${r.stallsCreated.join(', ')}` : 'none created'}${
    r.stallsSkipped.length ? `\n                (already existed: ${r.stallsSkipped.join(', ')})` : ''
  }`);
} finally {
  await pool.end();
}
