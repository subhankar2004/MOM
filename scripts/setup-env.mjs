// Creates local env files from their .env.example templates if they don't exist yet.
// Never overwrites a file you already have.
import { copyFileSync, existsSync } from 'node:fs';

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
