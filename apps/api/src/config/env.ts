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
