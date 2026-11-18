import { PgBoss } from 'pg-boss';
import type { Db } from '../db/client.js';
import { expireUnpaidOrders } from '../modules/payments/payments.service.js';
import { resetStallOverrides } from '../modules/stalls/stalls.service.js';

interface JobLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export const JOBS = {
  resetStallOverrides: 'stalls.reset-overrides',
  expireUnpaidOrders: 'orders.expire-unpaid',
} as const;

/**
 * Background jobs on pg-boss (a job queue stored in Postgres — no extra infrastructure).
 * Schedules are stored in the database, so with several API containers each job still runs
 * once per occurrence.
 */
export async function startJobs(databaseUrl: string, db: Db, log: JobLogger): Promise<() => Promise<void>> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss', application_name: 'mom-jobs' });
  boss.on('error', (err) => log.error({ err }, 'job queue error'));
  await boss.start();

  await boss.createQueue(JOBS.resetStallOverrides);
  // Every midnight in India; if the API was down at midnight, run once when it's back.
  await boss.schedule(JOBS.resetStallOverrides, '0 0 * * *', null, { tz: 'Asia/Kolkata', missed: 'once' });
  await boss.work(JOBS.resetStallOverrides, async () => {
    const reset = await resetStallOverrides(db);
    log.info({ job: JOBS.resetStallOverrides, stalls: reset.length }, 'stall open/close switches reset');
  });

  // UPI orders not paid within the time limit (15 min) expire; checked every minute.
  await boss.createQueue(JOBS.expireUnpaidOrders);
  await boss.schedule(JOBS.expireUnpaidOrders, '* * * * *', null, { tz: 'Asia/Kolkata' });
  await boss.work(JOBS.expireUnpaidOrders, async () => {
    const n = await expireUnpaidOrders(db, new Date());
    if (n > 0) log.info({ job: JOBS.expireUnpaidOrders, expired: n }, 'unpaid orders expired');
  });

  log.info({ jobs: Object.values(JOBS) }, 'background jobs started');
  return () => boss.stop({ graceful: true, timeout: 10_000 });
}
