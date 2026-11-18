import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://mom:mom@localhost:5432/mom',
  S3_BUCKET: 'mom-images',
  PUBLIC_IMAGE_BASE_URL: 'http://localhost:8333/mom-images',
  JWT_SECRET: 'j'.repeat(40),
  OTP_PEPPER: 'p'.repeat(40),
  QR_SECRET: 'q'.repeat(40),
};

/** What production needs on top of `base`: real SMS with India DLT ids. */
const awsSms = {
  SMS_PROVIDER: 'aws',
  AWS_SMS_ORIGINATION_IDENTITY: 'MOMVST',
  AWS_SMS_DLT_ENTITY_ID: '1101',
  AWS_SMS_DLT_TEMPLATE_ID: '1107',
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    loadEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.problems;
    throw err;
  }
  throw new Error('expected loadEnv to fail');
}

describe('loadEnv', () => {
  it('applies safe local defaults to a minimal config', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: ['http://localhost:3000'],
      S3_REGION: 'ap-south-1',
      S3_FORCE_PATH_STYLE: false,
      SMS_PROVIDER: 'console',
    });
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it('parses the committed .env.example values', () => {
    const env = loadEnv({
      ...base,
      API_PORT: '4000',
      S3_ENDPOINT: 'http://localhost:8333',
      S3_ACCESS_KEY_ID: 'mom-dev-access-key',
      S3_SECRET_ACCESS_KEY: 'mom-dev-secret-key',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.S3_ENDPOINT).toBe('http://localhost:8333');
  });

  it('splits and trims multiple web origins', () => {
    expect(loadEnv({ ...base, WEB_ORIGIN: 'http://a.test, https://b.test' }).WEB_ORIGIN).toEqual([
      'http://a.test',
      'https://b.test',
    ]);
  });

  it('treats empty strings as unset', () => {
    expect(loadEnv({ ...base, S3_ENDPOINT: '', API_PORT: '' })).toMatchObject({ API_PORT: 4000 });
  });

  it.each([
    ['missing DATABASE_URL', { DATABASE_URL: undefined }, 'DATABASE_URL'],
    ['non-Postgres DATABASE_URL', { DATABASE_URL: 'mysql://u@h/db' }, 'DATABASE_URL'],
    ['port out of range', { API_PORT: '99999' }, 'API_PORT'],
    ['invalid origin', { WEB_ORIGIN: 'not-a-url' }, 'WEB_ORIGIN.0'],
    ['unknown SMS provider', { SMS_PROVIDER: 'pigeon' }, 'SMS_PROVIDER'],
    ['unknown NODE_ENV', { NODE_ENV: 'prod' }, 'NODE_ENV'],
  ])('rejects %s', (_name, override, path) => {
    const problems = problemsOf({ ...base, ...override });
    expect(problems.some((p) => p.startsWith(`${path}:`))).toBe(true);
  });

  it('forbids the console SMS provider in production', () => {
    expect(problemsOf({ ...base, NODE_ENV: 'production' })).toEqual([
      expect.stringMatching(/^SMS_PROVIDER: .*must not be used in production/),
    ]);
  });

  it.each(['staging', 'production'])('forbids static S3 keys on %s', (NODE_ENV) => {
    const problems = problemsOf({
      ...base,
      ...awsSms,
      NODE_ENV,
      S3_ACCESS_KEY_ID: 'AKIA-something',
      S3_SECRET_ACCESS_KEY: 'shh',
    });
    expect(problems).toEqual([expect.stringMatching(/^S3_ACCESS_KEY_ID: .*IAM role/)]);
  });

  it('requires S3 keys as a pair', () => {
    expect(problemsOf({ ...base, S3_ACCESS_KEY_ID: 'only-half' })).toEqual([
      expect.stringMatching(/^S3_SECRET_ACCESS_KEY:/),
    ]);
  });

  it('never includes secret values in the error message', () => {
    const secret = 'super-secret-password-123';
    try {
      loadEnv({ ...base, DATABASE_URL: `mysql://mom:${secret}@db/mom`, NODE_ENV: 'nope' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it('normalises super-admin phones and rejects bad ones without echoing them', () => {
    expect(loadEnv({ ...base, SUPER_ADMIN_PHONES: '98765 43210, +916000000000' }).SUPER_ADMIN_PHONES).toEqual(
      ['+919876543210', '+916000000000'],
    );
    expect(loadEnv(base).SUPER_ADMIN_PHONES).toEqual([]);
    const problems = problemsOf({ ...base, SUPER_ADMIN_PHONES: '9876543210,12345' });
    expect(problems).toEqual(['SUPER_ADMIN_PHONES: entry 2 is not a valid Indian mobile']);
  });

  describe('auth settings (#7)', () => {
    it('requires long, distinct login secrets', () => {
      expect(problemsOf({ ...base, JWT_SECRET: 'short' })).toEqual([
        expect.stringMatching(/^JWT_SECRET: must be at least 32 characters/),
      ]);
      expect(problemsOf({ ...base, OTP_PEPPER: base.JWT_SECRET })).toEqual([
        'OTP_PEPPER: must be different from JWT_SECRET',
      ]);
      expect(problemsOf({ ...base, JWT_SECRET: undefined }).some((p) => p.startsWith('JWT_SECRET:'))).toBe(
        true,
      );
    });

    it('cookies are Secure everywhere except local development and tests', async () => {
      const { cookiesSecure } = await import('./env.js');
      expect(cookiesSecure({ NODE_ENV: 'development', COOKIE_SECURE: undefined })).toBe(false);
      expect(cookiesSecure({ NODE_ENV: 'test', COOKIE_SECURE: undefined })).toBe(false);
      expect(cookiesSecure({ NODE_ENV: 'staging', COOKIE_SECURE: undefined })).toBe(true);
      expect(cookiesSecure({ NODE_ENV: 'production', COOKIE_SECURE: undefined })).toBe(true);
      expect(cookiesSecure({ NODE_ENV: 'development', COOKIE_SECURE: true })).toBe(true);
    });

    it('allows test phones with a fixed code outside production only', () => {
      const env = loadEnv({ ...base, SMS_TEST_PHONES: '9000000001', SMS_TEST_CODE: '123456' });
      expect(env.SMS_TEST_PHONES).toEqual(['+919000000001']);
      expect(problemsOf({ ...base, SMS_TEST_PHONES: '9000000001' })).toEqual([
        'SMS_TEST_CODE: required when SMS_TEST_PHONES is set',
      ]);
      expect(
        problemsOf({
          ...base,
          ...awsSms,
          NODE_ENV: 'production',
          SMS_TEST_PHONES: '9000000001',
          SMS_TEST_CODE: '123456',
        }),
      ).toEqual([expect.stringMatching(/^SMS_TEST_PHONES: .*not allowed in production/)]);
      expect(problemsOf({ ...base, SMS_TEST_PHONES: '9000000001', SMS_TEST_CODE: '12ab56' })).toEqual([
        'SMS_TEST_CODE: must be 6 digits',
      ]);
    });

    it('AWS SMS needs the DLT sender and template ids', () => {
      expect(problemsOf({ ...base, SMS_PROVIDER: 'aws' })).toEqual([
        'AWS_SMS_ORIGINATION_IDENTITY: required when SMS_PROVIDER=aws',
        'AWS_SMS_DLT_ENTITY_ID: required when SMS_PROVIDER=aws',
        'AWS_SMS_DLT_TEMPLATE_ID: required when SMS_PROVIDER=aws',
      ]);
      expect(loadEnv({ ...base, ...awsSms, NODE_ENV: 'production' }).SMS_PROVIDER).toBe('aws');
    });
  });

  it('reports every problem at once', () => {
    expect(problemsOf({ API_PORT: 'abc' }).length).toBeGreaterThanOrEqual(4);
  });
});
