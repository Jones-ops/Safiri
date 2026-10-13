/**
 * Environment settings, checked once at start-up. The API refuses to start in production
 * with a missing secret, rather than failing on the first real request.
 */
const { z } = require('zod');

const optional = z.string().trim().min(1).optional();

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default(''), // comma-separated; the app itself doesn't need CORS

    SUPABASE_URL: optional,
    SUPABASE_SERVICE_ROLE_KEY: optional,
    SEND_SMS_HOOK_SECRET: optional, // "v1,whsec_..." from the Supabase Send SMS hook
    // Direct Postgres for money and inventory (transactions, holds) and the pg-boss job queue.
    DATABASE_URL: optional,
    // Signs the hold token given to guests so only they can view or release their hold.
    HOLD_TOKEN_SECRET: optional,

    AT_USERNAME: optional, // "sandbox" for the Africa's Talking sandbox
    AT_API_KEY: optional,
    AT_SENDER_ID: optional, // alphanumeric sender ID once approved (paperwork track)

    SENTRY_DSN: optional,

    // Android App Links: /.well-known/assetlinks.json lists the app and its signing key(s).
    ANDROID_PACKAGE: z.string().default('ke.safiri.app'),
    ANDROID_CERT_SHA256: optional, // comma-separated SHA-256 fingerprints (AA:BB:...)
    PLAY_STORE_URL: z.url().default('https://play.google.com/store/apps/details?id=ke.safiri.app'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'HOLD_TOKEN_SECRET', 'SEND_SMS_HOOK_SECRET', 'AT_USERNAME', 'AT_API_KEY']) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
  });

function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid API environment:\n${problems}\nSee apps/api/.env.example`);
  }
  return Object.freeze(parsed.data);
}

module.exports = { loadConfig };
