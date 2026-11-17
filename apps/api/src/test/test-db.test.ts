import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, DEFAULT_TEST_DATABASE_URL, testDatabaseUrl } from './test-db.js';

describe('test database guard', () => {
  it('accepts databases whose name ends in _test', () => {
    expect(assertTestDatabaseUrl('postgres://u:p@localhost:5432/mom_test')).toBe(
      'postgres://u:p@localhost:5432/mom_test',
    );
  });

  it.each([
    'postgres://u:p@localhost:5432/mom',
    'postgres://u:p@prod.example.com:5432/mom_prod',
    'postgres://u:p@localhost:5432/mom_test_backup',
    'postgres://u:p@localhost:5432/',
  ])('refuses %s', (url) => {
    expect(() => assertTestDatabaseUrl(url)).toThrow(/must end with "_test"/);
  });

  it('rejects a malformed URL without echoing it', () => {
    expect(() => assertTestDatabaseUrl('not a url with secret-password')).toThrow(
      'TEST_DATABASE_URL is not a valid URL',
    );
  });

  it('falls back to the local mom_test database', () => {
    expect(testDatabaseUrl({})).toBe(DEFAULT_TEST_DATABASE_URL);
    expect(testDatabaseUrl({ TEST_DATABASE_URL: '' })).toBe(DEFAULT_TEST_DATABASE_URL);
  });
});
