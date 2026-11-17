import { normalizeIndianMobile } from '@mom/shared';
import { z } from 'zod';

/**
 * Typed, validated configuration for the API.
 *
 * The API refuses to start if anything is missing or wrong (fail fast), and the
 * error lists every bad variable by name — never its value, so secrets are not
 * leaked into logs.
 */
const phoneList = z
  .string()
  .default('')
  .transform((v, ctx) =>
    v
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p, i) => {
        const e164 = normalizeIndianMobile(p);
        if (!e164) ctx.addIssue({ code: 'custom', message: `entry ${i + 1} is not a valid Indian mobile` });
        return e164 ?? '';
      }),
  );

/** A secret: long enough to resist guessing. Generate with `npm run setup` or `openssl rand -base64 48`. */
const secret = z.string().min(32, 'must be at least 32 characters (generate a random one)');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** 127.0.0.1 locally; the Docker image sets 0.0.0.0. */
    API_HOST: z.string().min(1).default('127.0.0.1'),
    /** Version reported by /health (the git SHA in CI/CD). */
    APP_VERSION: z.string().min(1).default('dev'),
    /** Trust X-Forwarded-For from this many proxy hops (1 behind the AWS ALB). 0 = none. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Default per-IP request budget per minute. Sensitive routes set stricter limits. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(10_000).default(300),
    /** Serve OpenAPI docs at /docs. Defaults to on, except in production. */
    API_DOCS: z.stringbool().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Allowed browser origin(s) for CORS, comma separated. */
    WEB_ORIGIN: z
      .string()
      .default('http://localhost:3000')
      .transform((v) => v.split(',').map((o) => o.trim()))
      .pipe(z.array(z.url()).min(1)),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    /** Leave S3_ENDPOINT empty on AWS — the SDK then uses real S3 and the task's IAM role. */
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('ap-south-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    /** Public base URL that menu/stall images are served from (CloudFront on AWS). */
    PUBLIC_IMAGE_BASE_URL: z.url(),

    SMS_PROVIDER: z.enum(['console', 'aws']).default('console'),

    /** Phones that are always super admins (bootstrap, spec §3). Comma separated, any common format. */
    SUPER_ADMIN_PHONES: phoneList,

    // --- Auth (#7) ---
    /** Signs the 15-minute access tokens (HS256). */
    JWT_SECRET: secret,
    /** Key for hashing OTP codes before they are stored (HMAC-SHA256). */
    OTP_PEPPER: secret,
    /** Send cookies only over HTTPS. Defaults to on, except in development/test (http://localhost). */
    COOKIE_SECURE: z.stringbool().optional(),
    /** Share cookies between api.<domain> and <domain>, e.g. ".mom.example". Unset locally. */
    COOKIE_DOMAIN: z.string().min(1).optional(),
    /**
     * Staging/dev only: these phones get SMS_TEST_CODE instead of a real SMS (store reviewers,
     * testing before DLT approval). Forbidden in production.
     */
    SMS_TEST_PHONES: phoneList,
    SMS_TEST_CODE: z
      .string()
      .regex(/^\d{6}$/, 'must be 6 digits')
      .optional(),

    // --- AWS End User Messaging SMS (SMS_PROVIDER=aws), India DLT ---
    AWS_REGION: z.string().min(1).default('ap-south-1'),
    /** The DLT-registered sender ID (header), e.g. "MOMVST". */
    AWS_SMS_ORIGINATION_IDENTITY: z.string().min(1).optional(),
    AWS_SMS_DLT_ENTITY_ID: z.string().min(1).optional(),
    AWS_SMS_DLT_TEMPLATE_ID: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const deployed = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'the console SMS provider prints OTPs to the logs and must not be used in production',
      });
    }
    if (deployed && env.S3_ACCESS_KEY_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY_ID'],
        message: 'static S3 keys are not allowed on AWS; use the ECS task IAM role',
      });
    }
    if (env.NODE_ENV === 'production' && (env.SMS_TEST_PHONES.length > 0 || env.SMS_TEST_CODE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_TEST_PHONES'],
        message: 'test phones with a fixed code are not allowed in production',
      });
    }
    if (env.SMS_TEST_PHONES.length > 0 && !env.SMS_TEST_CODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_TEST_CODE'],
        message: 'required when SMS_TEST_PHONES is set',
      });
    }
    if (env.SMS_PROVIDER === 'aws') {
      for (const key of [
        'AWS_SMS_ORIGINATION_IDENTITY',
        'AWS_SMS_DLT_ENTITY_ID',
        'AWS_SMS_DLT_TEMPLATE_ID',
      ] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when SMS_PROVIDER=aws' });
      }
    }
    if (env.JWT_SECRET === env.OTP_PEPPER) {
      ctx.addIssue({ code: 'custom', path: ['OTP_PEPPER'], message: 'must be different from JWT_SECRET' });
    }
    if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const isDeployed = (env: Pick<Env, 'NODE_ENV'>) =>
  env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
export const cookiesSecure = (env: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE'>) =>
  env.COOKIE_SECURE ?? !(env.NODE_ENV === 'development' || env.NODE_ENV === 'test');
export const apiDocsEnabled = (env: Pick<Env, 'NODE_ENV' | 'API_DOCS'>) =>
  env.API_DOCS ?? env.NODE_ENV !== 'production';

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parse and validate environment variables. Pure: pass `process.env` (or a test object). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty strings as "not set" so `S3_ENDPOINT=` in a .env file means "use AWS".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
