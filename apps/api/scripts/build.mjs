// Production build: bundles the API (and @mom/shared, which ships as TypeScript) into
// dist/ with esbuild. npm dependencies stay external and are installed in the image.
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@mom/'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: { server: 'src/server.ts', migrate: 'src/scripts/migrate.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: [...external, 'pg-native'],
  logLevel: 'info',
});
