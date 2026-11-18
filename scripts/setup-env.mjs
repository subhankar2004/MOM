// `npm run setup` — creates local env files from their .env.example templates and fills
// in random local secrets. Never overwrites a value you already set.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const files = [
  ['apps/api/.env.example', 'apps/api/.env'],
  ['apps/web/.env.example', 'apps/web/.env.local'],
];

for (const [example, target] of files) {
  if (existsSync(target)) {
    console.log(`✔ ${target} already exists — left unchanged`);
  } else {
    copyFileSync(example, target);
    console.log(`✚ created ${target} from ${example}`);
  }
}

// Secrets the API needs. Generated per machine; they never leave your computer.
const SECRETS = ['JWT_SECRET', 'OTP_PEPPER', 'QR_SECRET'];
const apiEnv = 'apps/api/.env';
let text = readFileSync(apiEnv, 'utf8');
for (const name of SECRETS) {
  const line = new RegExp(`^${name}=(.*)$`, 'm');
  const match = text.match(line);
  const value = randomBytes(48).toString('base64url');
  if (!match) {
    text += `${text.endsWith('\n') ? '' : '\n'}${name}=${value}\n`;
    console.log(`✚ generated ${name} in ${apiEnv}`);
  } else if (!match[1].trim()) {
    text = text.replace(line, `${name}=${value}`);
    console.log(`✚ generated ${name} in ${apiEnv}`);
  }
}
writeFileSync(apiEnv, text);
