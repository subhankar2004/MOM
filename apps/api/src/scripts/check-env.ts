// `npm run env:check` — validates apps/api/.env without starting the API.
import { EnvValidationError, loadEnv } from '../config/env.js';

try {
  const env = loadEnv();
  console.log(`✔ API environment OK (NODE_ENV=${env.NODE_ENV}, SMS_PROVIDER=${env.SMS_PROVIDER})`);
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
  throw err;
}
