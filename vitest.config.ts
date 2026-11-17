import { defineConfig } from 'vitest/config';

/**
 * One Vitest config for the whole monorepo.
 *   npm test          → fast unit tests (no Docker needed)
 *   npm run test:int  → integration tests against the real Postgres `mom_test` database
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'shared',
          root: 'packages/shared',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          root: 'apps/api',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'api-int',
          root: 'apps/api',
          include: ['src/**/*.int.test.ts'],
          // Integration tests share one database: run files one at a time.
          fileParallelism: false,
          globalSetup: ['src/test/global-setup.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
