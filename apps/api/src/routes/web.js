/**
 * The public web layer: pages for Google, AI assistants and people without the app,
 * plus robots.txt, sitemap.xml, llms.txt and the Android App Links file.
 * Paths match the app's deep links: /p/{slug}, /d/{slug}, /t/{id}, /i/{code}, /pay/{id}.
 */
const fs = require('node:fs');
const path = require('node:path');
const { formatAmount, formatKes, instalmentPreview, normalizeMsisdn } = require('@safiri/shared');
const { PaymentError } = require('../services/payments');
const { UUID } = require('../lib/access');
const { pickLanguage, translator } = require('../web/i18n');
const pages = require('../web/pages');

const SLUG = /^[a-z0-9-]{1,80}$/;
const ICON = path.join(__dirname, '..', '..', '..', 'mobile', 'assets', 'brand', 'icon.png');
const PAGE_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

async function webRoutes(app, { config, catalogue, payments, plans, payLinks, groups }) {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, '');

  function ctx(request) {
    const lang = pickLanguage(request);
    return {
      base,
      lang,
      t: translator(lang),
      supabaseUrl: config.SUPABASE_URL,
      playStoreUrl: config.PLAY_STORE_URL,
      androidPackage: config.ANDROID_PACKAGE,
    };
  }

  const sendPage = (reply, body, status = 200) =>
    reply
      .code(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', status === 200 ? PAGE_CACHE : 'no-store')
      .header('vary', 'Accept-Language')
      .send(String(body));

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, 'web page failed');
    sendPage(reply, pages.notFound(ctx(request), 'errors.generic'), 503);
  });

  app.get('/', async (request, reply) => {
    const [destinations, packages] = await Promise.all([catalogue.listDestinations(), catalogue.listPackages()]);
    return sendPage(reply, pages.home(ctx(request), { destinations, packages }));
  });

  app.get('/d/:slug', async (request, reply) => {
    const { slug } = request.params;
    const destination = SLUG.test(slug) ? await catalogue.getDestination(slug) : null;
    if (!destination) return sendPage(reply, pages.notFound(ctx(request), 'destination.notFound'), 404);
    const packages = (await catalogue.listPackages()).filter((p) => p.destination.slug === slug);
    return sendPage(reply, pages.destination(ctx(request), { destination, packages }));
  });

  app.get('/p/:slug', async (request, reply) => {
    const { slug } = request.params;
    const pkg = SLUG.test(slug) ? await catalogue.getPackage(slug) : null;
    if (!pkg) return sendPage(reply, pages.notFound(ctx(request), 'pkg.notFound'), 404);
    return sendPage(reply, pages.packagePage(ctx(request), pkg));
  });

  app.get('/privacy', async (request, reply) => sendPage(reply, pages.privacy(ctx(request))));

  // One-tap pay links work in any browser: one button sends the M-PESA prompt. Never indexed.
  const privatePage = (reply, body, status = 200) =>
    reply.code(status).header('x-robots-tag', 'noindex').header('cache-control', 'no-store')
      .header('content-type', 'text/html; charset=utf-8').send(String(body));
  const PAY_ERRORS = ['payment_in_progress', 'mpesa_unavailable', 'mpesa_not_configured', 'not_payable', 'amount_over_limit'];

  async function payTarget(code) {
    const instalmentId = payLinks.instalmentIdFrom(code);
    const t = instalmentId ? await plans.payLinkTarget(instalmentId) : null;
    if (!t) return null;
    return {
      ref: t.ref, title: t.title, bookingId: t.booking_id, bookingStatus: t.booking_status,
      amountKes: t.next_kes, balanceKes: t.balance_kes, msisdn: t.phone, phone: `0${t.phone.slice(3, 6)} *** ${t.phone.slice(-3)}`,
    };
  }

  // Form posts from the pay page (no JavaScript), parsed only inside this plugin.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body))));

  app.get('/pay/:code', async (request, reply) => {
    const target = await payTarget(request.params.code);
    if (!target) return privatePage(reply, pages.notFound(ctx(request)), 404);
    return privatePage(reply, pages.payPage(ctx(request), { code: request.params.code, target }));
  });

  app.post('/pay/:code', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { code } = request.params;
    const target = await payTarget(code);
    if (!target) return privatePage(reply, pages.notFound(ctx(request)), 404);
    const typed = String(request.body?.phone || '').trim();
    const phone = typed ? normalizeMsisdn(typed) : target.msisdn;
    if (!phone) return privatePage(reply, pages.payPage(ctx(request), { code, target, error: 'errors.phone.invalid' }), 422);
    try {
      const started = await payments.startPayment({ bookingId: target.bookingId, option: 'instalment', phone });
      const lang = ctx(request).lang === 'sw' ? '?lang=sw' : '';
      return reply.redirect(`/pay/${code}/status/${started.paymentId}${lang}`, 303);
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err;
      const error = PAY_ERRORS.includes(err.code) ? `checkout.errors.${err.code}` : 'errors.generic';
      return privatePage(reply, pages.payPage(ctx(request), { code, target, error }), err.status);
    }
  });

  const toStatus = (p) => ({ paymentId: p.id, status: p.status, amountKes: p.amount_kes, receipt: p.mpesa_receipt?.startsWith('UNKNOWN-') ? null : p.mpesa_receipt });

  app.get('/pay/:code/status/:paymentId', async (request, reply) => {
    const { code, paymentId } = request.params;
    const target = await payTarget(code);
    if (!target || !UUID.test(paymentId) || (await payments.paymentBookingId(paymentId)) !== target.bookingId) {
      return privatePage(reply, pages.notFound(ctx(request)), 404);
    }
    const p = await payments.getPayment(paymentId);
    return privatePage(reply, pages.payStatusPage(ctx(request), { basePath: `/pay/${code}`, payment: toStatus(p) }));
  });

  // Group invites: a friend pays their share from the link, no app needed. Never indexed.
  app.get('/i/:code', async (request, reply) => {
    const invite = await groups.inviteTarget(request.params.code);
    if (!invite) return privatePage(reply, pages.notFound(ctx(request)), 404);
    return privatePage(reply, pages.invitePage(ctx(request), { code: request.params.code, invite }));
  });

  app.post('/i/:code', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { code } = request.params;
    const invite = await groups.inviteTarget(code);
    if (!invite) return privatePage(reply, pages.notFound(ctx(request)), 404);
    const typed = String(request.body?.phone || '').trim();
    const phone = typed ? normalizeMsisdn(typed) : invite.msisdn;
    if (!phone) return privatePage(reply, pages.invitePage(ctx(request), { code, invite, error: 'errors.phone.invalid' }), 422);
    try {
      const started = await payments.startSharePayment({ memberId: invite.memberId, phone });
      const lang = ctx(request).lang === 'sw' ? '?lang=sw' : '';
      return reply.redirect(`/i/${code}/status/${started.paymentId}${lang}`, 303);
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err;
      const known = [...PAY_ERRORS, 'hold_expired'];
      const error = known.includes(err.code) ? `checkout.errors.${err.code}` : 'errors.generic';
      return privatePage(reply, pages.invitePage(ctx(request), { code, invite, error }), err.status);
    }
  });

  app.get('/i/:code/status/:paymentId', async (request, reply) => {
    const { code, paymentId } = request.params;
    const invite = await groups.inviteTarget(code);
    if (!invite || !UUID.test(paymentId)) return privatePage(reply, pages.notFound(ctx(request)), 404);
    const p = await payments.getPayment(paymentId);
    if (!p || p.member_id !== invite.memberId) return privatePage(reply, pages.notFound(ctx(request)), 404);
    return privatePage(reply, pages.payStatusPage(ctx(request), { basePath: `/i/${code}`, payment: toStatus(p) }));
  });

  // Trip links: the app handles them; the web explains how to open them. Never indexed.
  for (const [route, appPrefix] of [['/t/:id', 't']]) {
    app.get(route, async (request, reply) => {
      const id = String(request.params.id).slice(0, 64).replace(/[^A-Za-z0-9-]/g, '');
      const body = pages.appOnly(ctx(request), `${appPrefix}/${id}`, `/${appPrefix}/${id}`);
      return reply.header('x-robots-tag', 'noindex').header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(String(body));
    });
  }

  app.get('/robots.txt', async (_request, reply) =>
    reply.type('text/plain').header('cache-control', PAGE_CACHE).send(
      ['User-agent: *', 'Allow: /', 'Disallow: /t/', 'Disallow: /i/', 'Disallow: /pay/', 'Disallow: /v1/', 'Disallow: /hooks/', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n'),
    ));

  app.get('/sitemap.xml', async (_request, reply) => {
    const [destinations, packages] = await Promise.all([catalogue.listDestinations(), catalogue.listPackages()]);
    const entry = (loc, lastmod) => {
      const alt = (lang, href) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${href}"/>`;
      return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}${alt('en', loc)}${alt('sw', `${loc}?lang=sw`)}</url>`;
    };
    const urls = [
      entry(`${base}/`),
      ...destinations.map((d) => entry(`${base}/d/${d.slug}`, d.updatedAt)),
      ...packages.map((p) => entry(`${base}/p/${p.slug}`, p.updatedAt)),
    ];
    return reply
      .type('application/xml')
      .header('cache-control', PAGE_CACHE)
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
  });

  // A plain-language summary for AI assistants (llmstxt.org format).
  app.get('/llms.txt', async (_request, reply) => {
    const [destinations, packages] = await Promise.all([catalogue.listDestinations(), catalogue.listPackages()]);
    const t = translator('en');
    const lines = [
      '# Safiri',
      '',
      '> Safiri is a Kenyan travel app for weekend getaways from Nairobi. Every price is all-in, per person (twin share), in Kenyan shillings, and can be paid in M-PESA instalments or split with friends.',
      '',
      'Booking is in the Safiri Android app; these pages describe what is on offer. A deposit holds a place; the balance is due 7 days before travel. Providers are licensed and verified, and reviews come only from travellers who completed the trip.',
      '',
      '## Destinations',
      ...destinations.map((d) => `- [${d.name}](${base}/d/${d.slug}): ${d.summary} Getting there: ${d.gettingThere}`),
      '',
      '## Trips',
      ...packages.map((p) => {
        const preview = instalmentPreview({ totalKes: p.fromPriceKes, depositPct: p.depositPct, instalmentCount: p.instalments });
        const price = `${formatKes(p.fromPriceKes)} per person${preview ? `, or ${preview.times} payments of KES ${formatAmount(preview.amountKes)}` : ''}`;
        const length = p.nights === 0 ? t('pkg.dayTrip') : p.nights === 1 ? t('pkg.oneNight') : t('pkg.nights', { n: p.nights });
        return `- [${p.title}](${base}/p/${p.slug}): ${p.destination.name}, ${length}. ${price}. ${p.summary}`;
      }),
      '',
      '## Optional',
      `- [Privacy notice](${base}/privacy)`,
      `- [Sitemap](${base}/sitemap.xml)`,
      '',
    ];
    return reply.type('text/plain; charset=utf-8').header('cache-control', PAGE_CACHE).send(lines.join('\n'));
  });

  // Android App Links verification. Needs the release signing key fingerprint(s).
  app.get('/.well-known/assetlinks.json', async (request, reply) => {
    const fingerprints = (config.ANDROID_CERT_SHA256 || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!fingerprints.length) {
      request.log.warn('ANDROID_CERT_SHA256 is not set: App Links cannot verify');
      return reply.code(404).send({ error: 'not_configured' });
    }
    return reply
      .type('application/json')
      .header('cache-control', 'public, max-age=3600')
      .send([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: config.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
        },
      ]);
  });

  app.get('/static/icon.png', async (_request, reply) =>
    reply.type('image/png').header('cache-control', 'public, max-age=604800').send(fs.createReadStream(ICON)));
}

module.exports = webRoutes;
