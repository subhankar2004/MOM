// Root ESLint config for the whole monorepo (flat config).
// Next.js / React rules apply to apps/web only.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import nextConfigs from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/cdk.out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Next.js + React + hooks + jsx-a11y rules for the web app. The typescript preset is skipped:
  // typescript-eslint is already configured above for the whole repo.
  ...nextConfigs
    .filter((c) => c.name === 'next' || c.name === 'next/core-web-vitals')
    .map((c) => ({ ...c, files: ['apps/web/**/*.{ts,tsx}'] })),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    // Keep the TypeScript parser (Next's preset swaps in its own, which the TS rules can't use).
    languageOptions: { parser: tseslint.parser, globals: { ...globals.browser } },
    settings: { next: { rootDir: 'apps/web' }, react: { version: 'detect' } },
  },
  {
    ignores: ['apps/web/next-env.d.ts', 'apps/web/playwright-report/**', 'apps/web/test-results/**'],
  },
  {
    // Command-line scripts talk to the user through the console.
    files: ['scripts/**', '**/src/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
