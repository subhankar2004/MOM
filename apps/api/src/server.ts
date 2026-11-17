// Entry point: `npm run dev` (watch mode) or `node dist/server.js` in the container.
import { buildApp } from './app.js';
import { EnvValidationError, loadEnv } from './config/env.js';
import { createDb } from './db/client.js';

let env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const { db, pool } = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

// Postgres connections that break while idle must not crash the process.
pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));
app.addHook('onClose', async () => {
  await pool.end();
});

/** Graceful shutdown: stop accepting requests, finish in-flight ones, close the DB pool. */
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      app.log.error('shutdown took longer than 10 s, exiting');
      process.exit(1);
    }, 10_000).unref();
    app.close().then(
      () => {
        clearTimeout(force);
        process.exit(0);
      },
      (err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
  app.log.fatal({ err }, 'could not start the API');
  await pool.end();
  process.exit(1);
}
