import { normalizeIndianMobile } from '@mom/shared';
import { z } from 'zod';

/**
 * Typed, validated configuration for the API.
 *
 * The API refuses to start if anything is missing or wrong (fail fast), and the
 * error lists every bad variable by name — never its value, so secrets are not
 * leaked into logs.
 */
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
    SUPER_ADMIN_PHONES: z
      .string()
      .default('')
      .transform((v, ctx) =>
        v
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => {
            const e164 = normalizeIndianMobile(p);
            if (!e164)
              ctx.addIssue({ code: 'custom', message: `entry ${i + 1} is not a valid Indian mobile` });
            return e164 ?? '';
          }),
      ),
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
