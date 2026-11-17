import { TransactionRollbackError } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadEnv, type Env } from '../config/env.js';
import { createDb, type Db } from '../db/client.js';
import type { SmsMessage, SmsProvider } from '../sms/index.js';
import { testDatabaseUrl } from './test-db.js';

/** A valid config for tests; override any variable. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgres://mom:mom@127.0.0.1:5432/mom_test',
    S3_BUCKET: 'mom-images',
    PUBLIC_IMAGE_BASE_URL: 'http://localhost:8333/mom-images',
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-0123456789',
    OTP_PEPPER: 'test-otp-pepper-that-is-long-enough-9876543210',
    ...overrides,
  });
}

export interface TestApp {
  app: FastifyInstance;
  /** The same transaction the app uses — for arranging data and asserting on it. */
  db: Db;
  /** Every SMS the app "sent" during the test (nothing really leaves the machine). */
  sms: SmsMessage[];
  /** Closes the app and rolls back everything the test (and the app) wrote. */
  close: () => Promise<void>;
}

/**
 * Starts the API against the real `*_test` database inside ONE transaction that is
 * rolled back at the end, so tests never leave data behind and can run in any order.
 * Code inside the app that opens its own transaction gets a savepoint instead.
 *
 *   const t = await createTestApp();
 *   afterEach(() => t.close());
 */
export async function createTestApp(
  envOverrides: Record<string, string> = {},
  options: { now?: () => Date } = {},
): Promise<TestApp> {
  const { db, pool } = createDb(testDatabaseUrl(), { max: 1, applicationName: 'mom-test' });

  let endTest!: () => void;
  const testFinished = new Promise<void>((resolve) => (endTest = resolve));
  let provideTx!: (tx: Db) => void;
  const txReady = new Promise<Db>((resolve) => (provideTx = resolve));

  const transaction = db
    .transaction(async (tx) => {
      provideTx(tx);
      await testFinished;
      tx.rollback(); // throws TransactionRollbackError → ROLLBACK
    })
    .catch((err: unknown) => {
      if (!(err instanceof TransactionRollbackError)) throw err;
    });

  const tx = await Promise.race([
    txReady,
    transaction.then(() => Promise.reject(new Error('transaction ended'))),
  ]);
  const sms: SmsMessage[] = [];
  const captureSms: SmsProvider = {
    name: 'test',
    send: async (message) => {
      sms.push(message);
    },
  };
  const app = await buildApp({
    env: testEnv(envOverrides),
    db: tx,
    logger: false,
    sms: captureSms,
    now: options.now,
    stallsCacheTtlMs: 0,
  });
  await app.ready();

  return {
    app,
    db: tx,
    sms,
    close: async () => {
      await app.close();
      endTest();
      await transaction;
      await pool.end();
    },
  };
}
