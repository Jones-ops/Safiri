/**
 * Builds the Fastify app. Dependencies (Supabase, SMS, token check) can be swapped in tests,
 * so the app is testable without network access.
 */
const Fastify = require('fastify');
const Sentry = require('@sentry/node');
const { createSupabaseAdmin, createTokenVerifier } = require('./integrations/supabase');
const { createSmsClient } = require('./integrations/africastalking');
const { createProfilesService } = require('./services/profiles');
const { createCatalogue } = require('./services/catalogue');
const { createQuoteService } = require('./services/quotes');
const { createHoldService } = require('./services/holds');
const { createPaymentService } = require('./services/payments');
const { createDaraja } = require('./integrations/daraja');
const { createPushClient } = require('./integrations/push');
const { createWhatsApp } = require('./integrations/whatsapp');
const { createNotifier } = require('./services/notifier');
const { createPlanRunner } = require('./services/plans');
const { createPayLinks } = require('./lib/paylink');
const { createBookingAccess } = require('./lib/access');
const { createGroupService } = require('./services/groups');
const { createItineraryService } = require('./services/itinerary');
const { createDb } = require('./lib/db');
const { requireUser, optionalUser } = require('./lib/auth');
const { createRoleGuard } = require('./lib/roles');
const { createManageService } = require('./services/manage');
const { createProviderService } = require('./services/providers');
const { createSettlementService } = require('./services/settlement');
const { createCancellationService } = require('./services/cancellations');
const { createSignedCodes } = require('./lib/paylink');
const { createAccountService } = require('./services/account');

async function buildApp(config, overrides = {}) {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      // Never log tokens or full request bodies (they can contain phone numbers and OTPs).
      redact: ['req.headers.authorization', 'req.headers["webhook-signature"]'],
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: config.TRUST_PROXY,
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
    catalogue: overrides.catalogue || createCatalogue(supabase),
    db: overrides.db !== undefined ? overrides.db : createDb(config.DATABASE_URL),
  };
  deps.account = createAccountService({ db: deps.db, supabase, log: app.log });
  deps.quotes = overrides.quotes || createQuoteService(deps.db, { referrals: deps.account });
  deps.holds = overrides.holds || createHoldService(deps.db, { tokenSecret: config.HOLD_TOKEN_SECRET });
  deps.daraja = overrides.daraja || createDaraja({
    env: config.DARAJA_ENV,
    consumerKey: config.DARAJA_CONSUMER_KEY,
    consumerSecret: config.DARAJA_CONSUMER_SECRET,
    shortcode: config.DARAJA_SHORTCODE,
    passkey: config.DARAJA_PASSKEY,
    callbackUrl: config.DARAJA_CALLBACK_BASE_URL && config.DARAJA_CALLBACK_SECRET
      ? `${config.DARAJA_CALLBACK_BASE_URL.replace(/\/$/, '')}/hooks/mpesa/stk/${config.DARAJA_CALLBACK_SECRET}`
      : null,
    b2c: {
      shortcode: config.DARAJA_B2C_SHORTCODE,
      initiatorName: config.DARAJA_B2C_INITIATOR_NAME,
      securityCredential: config.DARAJA_B2C_SECURITY_CREDENTIAL,
      resultUrl: config.DARAJA_CALLBACK_BASE_URL && config.DARAJA_CALLBACK_SECRET
        ? `${config.DARAJA_CALLBACK_BASE_URL.replace(/\/$/, '')}/hooks/mpesa/b2c/${config.DARAJA_CALLBACK_SECRET}`
        : null,
    },
  });
  deps.payments = overrides.payments || createPaymentService({ db: deps.db, daraja: deps.daraja, sms: deps.sms, log: app.log });
  deps.payLinks = createPayLinks(config.HOLD_TOKEN_SECRET);
  deps.notifier = overrides.notifier || createNotifier({
    db: deps.db,
    sms: deps.sms,
    push: overrides.push || createPushClient(),
    whatsapp: overrides.whatsapp || createWhatsApp({ phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID, accessToken: config.WHATSAPP_ACCESS_TOKEN }),
    log: app.log,
  });
  deps.plans = createPlanRunner({ db: deps.db, notifier: deps.notifier, payLinks: deps.payLinks, baseUrl: config.PUBLIC_BASE_URL, log: app.log });
  deps.itinerary = createItineraryService({ db: deps.db, supportPhone: config.SUPPORT_PHONE });
  deps.groups = createGroupService({ db: deps.db, baseUrl: config.PUBLIC_BASE_URL });
  deps.mayAccess = createBookingAccess({ payments: deps.payments, holds: deps.holds });
  deps.requireUser = requireUser(deps.verifyToken);
  deps.optionalUser = optionalUser(deps.verifyToken);
  deps.requireRole = createRoleGuard({ db: deps.db, requireUser: deps.requireUser });
  deps.manage = createManageService({ db: deps.db, quotes: deps.quotes });
  deps.requestCodes = createSignedCodes(config.HOLD_TOKEN_SECRET, 'req');
  deps.providers = overrides.providers || createProviderService({ db: deps.db, notifier: deps.notifier, requestCodes: deps.requestCodes, baseUrl: config.PUBLIC_BASE_URL, log: app.log });
  deps.settlement = overrides.settlement || createSettlementService({ db: deps.db, daraja: deps.daraja, log: app.log });
  deps.cancellations = createCancellationService({ db: deps.db, notifier: deps.notifier, log: app.log });
  // Once a booking confirms, its providers are asked to accept, and a referrer earns their reward.
  deps.payments.hooks.onConfirmed = async (bookingId) => {
    await deps.providers.sendRequests(bookingId);
    await deps.account.rewardOnConfirm(bookingId);
  };
  // A hold on a discounted quote uses up the new traveller's one referral.
  deps.holds.hooks.onHeld = (held) => deps.account.redeem(held);

  await app.register(require('@fastify/sensible'));
  // Security headers for the web pages. Styles are inline (no stylesheet request on 3G); the
  // only scripts are JSON-LD data blocks, which browsers never execute; images come from Storage.
  const supabaseOrigin = config.SUPABASE_URL ? new URL(config.SUPABASE_URL).origin : null;
  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', ...(supabaseOrigin ? [supabaseOrigin] : [])],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Storage images are cross-origin
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  // API responses carry personal data: never cache them anywhere in between.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/v1/')) reply.header('cache-control', 'no-store');
  });
  await app.register(require('@fastify/cors'), {
    origin: config.CORS_ORIGINS ? config.CORS_ORIGINS.split(',').map((s) => s.trim()) : false,
  });
  await app.register(require('@fastify/rate-limit'), { max: 120, timeWindow: '1 minute' });

  await app.register(require('./routes/health'), deps);
  await app.register(require('./routes/hooks'), deps);
  await app.register(require('./routes/me'), deps);
  await app.register(require('./routes/build'), deps);
  await app.register(require('./routes/pay'), deps);
  await app.register(require('./routes/plans'), deps);
  await app.register(require('./routes/groups'), deps);
  await app.register(require('./routes/travel'), deps);
  await app.register(require('./routes/manage'), deps);
  await app.register(require('./routes/providers'), deps);
  await app.register(require('./routes/account'), deps);
  await app.register(require('./routes/web'), deps);

  if (config.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app);

  // Close the database pool with the server (it is ours unless a test passed one in).
  app.addHook('onClose', async () => {
    if (deps.db && overrides.db === undefined) await deps.db.end();
  });
  app.decorate('services', deps);

  return app;
}

module.exports = { buildApp };
