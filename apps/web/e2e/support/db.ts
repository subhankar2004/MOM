import pg from 'pg';
import { E2E_DATABASE_URL, PHONE_PREFIX } from './env';

/** Direct database access for arranging test data (roles) and cleaning up. */
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!new URL(E2E_DATABASE_URL).pathname.endsWith('_test')) {
    throw new Error('Browser tests only run against a *_test database');
  }
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Removes every account, code and session the browser tests created. */
export function resetTestUsers() {
  return withDb(async (db) => {
    const like = `${PHONE_PREFIX}%`;
    await db.query(`delete from refresh_tokens where user_id in (select id from users where phone like $1)`, [
      like,
    ]);
    await db.query(`delete from users where phone like $1`, [like]);
    await db.query(`delete from auth_otps where phone like $1`, [like]);
  });
}

/** Creates (or resets) an account directly, e.g. an admin who then signs in through the UI. */
export function createUser(phone: string, name: string, role: 'student' | 'vendor_owner' | 'super_admin') {
  return withDb((db) =>
    db.query(
      `insert into users (phone, name, role) values ($1, $2, $3)
       on conflict (phone) do update set name = excluded.name, role = excluded.role`,
      [phone, name, role],
    ),
  );
}

export function setRole(phone: string, role: 'student' | 'vendor_owner' | 'super_admin') {
  return withDb((db) => db.query(`update users set role = $2 where phone = $1`, [phone, role]));
}
