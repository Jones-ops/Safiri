/**
 * Builds the Fastify app. Dependencies (Supabase, SMS, token check) can be swapped in tests,
 * so the app is testable without network access.
 */
const Fastify = require('fastify');
const Sentry = require('@sentry/node');
const { createSupabaseAdmin, createTokenVerifier } = require('./integrations/supabase');
const { createSmsClient } = require('./integrations/africastalking');
const { createProfilesService } = require('./services/profiles');
const { requireUser } = require('./lib/auth');

async function buildApp(config, overrides = {}) {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      // Never log tokens or full request bodies (they can contain phone numbers and OTPs).
      redact: ['req.headers.authorization', 'req.headers["webhook-signature"]'],
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  const supabase = overrides.supabase !== undefined
    ? overrides.supabase
    : createSupabaseAdmin({ url: config.SUPABASE_URL, serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY });
  const deps = {
    config,
    supabase,
    verifyToken: overrides.verifyToken || createTokenVerifier(supabase),
    sms: overrides.sms || createSmsClient({
      username: config.AT_USERNAME,
      apiKey: config.AT_API_KEY,
      senderId: config.AT_SENDER_ID,
      log: app.log,
      devMode: config.NODE_ENV !== 'production',
    }),
    profiles: overrides.profiles || createProfilesService(supabase),
  };
  deps.requireUser = requireUser(deps.verifyToken);

  await app.register(require('@fastify/sensible'));
  await app.register(require('@fastify/cors'), {
    origin: config.CORS_ORIGINS ? config.CORS_ORIGINS.split(',').map((s) => s.trim()) : false,
  });
  await app.register(require('@fastify/rate-limit'), { max: 120, timeWindow: '1 minute' });

  await app.register(require('./routes/health'), deps);
  await app.register(require('./routes/hooks'), deps);
  await app.register(require('./routes/me'), deps);

  if (config.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app);

  return app;
}

module.exports = { buildApp };
