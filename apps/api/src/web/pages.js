/** Public pages. Every price is the all-in per-person price, with the instalment line. */
const { formatAmount, formatKes, instalmentPreview, photoUrl, refundLines } = require('@safiri/shared');
const { html, raw } = require('./html');
const { page } = require('./layout');
const { localised } = require('./i18n');
const { homeGraph, destinationGraph, packageGraph } = require('./jsonld');

const langQuery = (lang) => (lang === 'sw' ? '?lang=sw' : '');

function nightsLabel(nights, t) {
  return nights === 0 ? t('pkg.dayTrip') : nights === 1 ? t('pkg.oneNight') : t('pkg.nights', { n: nights });
}

function priceBlock(pkg, t) {
  const preview = instalmentPreview({ totalKes: pkg.fromPriceKes, depositPct: pkg.depositPct, instalmentCount: pkg.instalments });
  return html`<div class="price">${t('price.perPerson', { amount: formatKes(pkg.fromPriceKes) })}</div>
${preview ? html`<span class="badge">${t('price.orInstalments', { times: preview.times, amount: formatAmount(preview.amountKes) })}</span>` : ''}`;
}

function picture(ctx, key, alt, { hero = false } = {}) {
  const small = photoUrl(ctx.supabaseUrl, key, 640);
  if (!small) return '';
  const large = photoUrl(ctx.supabaseUrl, key, 1280);
  return html`<img src="${small}" srcset="${small} 640w, ${large} 1280w" sizes="${hero ? '100vw' : '(min-width: 960px) 320px, 100vw'}"
 alt="${alt}" width="640" height="360" ${hero ? '' : html`loading="lazy"`} decoding="async">`;
}

function packageCard(ctx, pkg) {
  const { t, lang } = ctx;
  return html`<a class="card" href="/p/${pkg.slug}${langQuery(lang)}">
${picture(ctx, pkg.heroImage, localised(pkg, 'title', lang))}
<div class="body"><span class="muted">${pkg.destination.name} · ${nightsLabel(pkg.nights, t)}</span>
<h3>${localised(pkg, 'title', lang)}</h3>${priceBlock(pkg, t)}</div></a>`;
}

function home(ctx, { destinations, packages }) {
  const { t, lang } = ctx;
  const hero = destinations[0]?.heroImage;
  const body = html`<section class="hero">${picture(ctx, 'maasai-mara-savanna', '', { hero: true }) || picture(ctx, hero, '', { hero: true })}
<div class="scrim"></div><div class="text"><h1>${t('web.homeTitle')}</h1><p>${t('web.homeIntro')}</p></div></section>
<div class="wrap">
<h2>${t('web.destinations')}</h2>
<nav class="chips">${destinations.map((d) => html`<a href="/d/${d.slug}${langQuery(lang)}">${d.name}</a>`)}</nav>
<h2>${t('web.trips')}</h2>
<div class="grid">${packages.map((p) => packageCard(ctx, p))}</div>
</div>`;
  return page({
    ...ctx,
    path: '/',
    title: `Safiri · ${t('web.tagline')}`,
    description: t('web.homeIntro'),
    image: photoUrl(ctx.supabaseUrl, 'maasai-mara-savanna', 1280),
    jsonLd: homeGraph({ base: ctx.base, packages, lang }),
    body,
  });
}

function destination(ctx, { destination: d, packages }) {
  const { t, lang } = ctx;
  const faq = localised(d, 'faq', lang) || [];
  const image = photoUrl(ctx.supabaseUrl, d.heroImage, 1280);
  const body = html`<section class="hero">${picture(ctx, d.heroImage, d.name, { hero: true })}<div class="scrim"></div>
<div class="text"><h1>${d.name}</h1><p>${localised(d, 'summary', lang)}</p></div></section>
<div class="wrap">
<h2>${t('destination.bestTime')}</h2><p>${localised(d, 'bestTime', lang)}</p>
<h2>${t('destination.gettingThere')}</h2><p>${localised(d, 'gettingThere', lang)}</p>
<h2>${t('destination.packages', { name: d.name })}</h2>
${packages.length ? html`<div class="grid">${packages.map((p) => packageCard(ctx, p))}</div>` : html`<p class="muted">${t('destination.noPackages')}</p>`}
${faq.length ? html`<h2>${t('destination.faq')}</h2>${faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}` : ''}
</div>`;
  return page({
    ...ctx,
    path: `/d/${d.slug}`,
    title: `${d.name} · Safiri`,
    description: localised(d, 'summary', lang),
    image,
    jsonLd: destinationGraph({ base: ctx.base, destination: d, packages, lang, t, image }),
    body,
  });
}

function packagePage(ctx, pkg) {
  const { t, lang } = ctx;
  const d = pkg.destination;
  const title = localised(pkg, 'title', lang);
  const preview = instalmentPreview({ totalKes: pkg.fromPriceKes, depositPct: pkg.depositPct, instalmentCount: pkg.instalments });
  const providers = [...new Map(pkg.items.map((i) => [i.provider.name, i.provider])).values()];
  const image = photoUrl(ctx.supabaseUrl, pkg.heroImage, 1280);
  const rating = pkg.reviews.length ? Math.round((pkg.reviews.reduce((s, r) => s + r.rating, 0) / pkg.reviews.length) * 10) / 10 : null;

  const body = html`<section class="hero">${picture(ctx, pkg.heroImage, title, { hero: true })}<div class="scrim"></div>
<div class="text"><span>${d.name} · ${nightsLabel(pkg.nights, t)}</span><h1>${title}</h1></div></section>
<div class="wrap">
<p>${localised(pkg, 'summary', lang)}</p>
${priceBlock(pkg, t)}
<h2>${t('pkg.plan')}</h2>
<ol class="plan">${pkg.items.map((i) => html`<li><strong>${t('pkg.day', { n: i.day })}</strong>: ${i.title} <span class="muted">(${i.provider.name})</span></li>`)}</ol>
<h3>${t('pkg.included')}</h3><ul>${pkg.inclusions.map((x) => html`<li>${x}</li>`)}</ul>
${pkg.exclusions.length ? html`<h3>${t('pkg.notIncluded')}</h3><ul>${pkg.exclusions.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
<h2>${t('pkg.paymentPlan')}</h2>
${preview
    ? html`<table class="pay">${preview.schedule.map((amount, i) => html`<tr><td>${i === 0 ? t('pkg.deposit') : t('pkg.instalmentN', { n: i })}</td><td>${formatKes(amount)}</td></tr>`)}</table>
<p class="muted">${t('pkg.payPlanNote', { days: pkg.finalDueDays })}</p>`
    : html`<p>${t('pkg.payInFull')}</p>`}
<h2>${t('pkg.cancelPolicy')}</h2><ul>${refundLines(pkg.cancelPolicy, t).map((l) => html`<li>${l}</li>`)}</ul>
<h2>${t('pkg.providers')}</h2>
<ul>${providers.map((p) => html`<li>${p.name} <span class="verified">✓ ${t('trust.verified')}</span>${p.licenceNo ? html` <span class="muted">${t('trust.licence', { number: p.licenceNo })}</span>` : ''}</li>`)}</ul>
<h2>${t('pkg.reviews')}</h2>
${rating ? html`<p><strong>${t('pkg.ratingSummary', { rating, n: pkg.reviews.length })}</strong></p>
${pkg.reviews.slice(0, 5).map((r) => html`<blockquote>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}<br>${r.body || ''}<br><span class="muted">${t('pkg.verifiedTraveller')} · ${r.createdAt.slice(0, 10)}</span></blockquote>`)}`
    : html`<p class="muted">${t('pkg.noReviews')}</p>`}
${d.faq?.length ? html`<h2>${t('destination.faq')}</h2>${localised(d, 'faq', lang).map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}` : ''}
<p><a href="/d/${d.slug}${langQuery(lang)}">${d.name}</a> · <a href="/${langQuery(lang)}">${t('web.backHome')}</a></p>
</div>`;

  return page({
    ...ctx,
    path: `/p/${pkg.slug}`,
    title: `${title} · ${formatKes(pkg.fromPriceKes)} · Safiri`,
    description: `${localised(pkg, 'summary', lang)} ${t('price.perPerson', { amount: formatKes(pkg.fromPriceKes) })}`,
    image,
    jsonLd: packageGraph({ base: ctx.base, pkg, lang, t, image }),
    appPath: `p/${pkg.slug}`,
    stickyLeft: html`<strong>${t('web.from', { amount: formatKes(pkg.fromPriceKes) })}</strong>`,
    body,
  });
}

function privacy(ctx) {
  const { t } = ctx;
  const body = html`<div class="wrap"><h1>${t('privacy.title')}</h1><p>${t('privacy.intro')}</p>
${[['whatTitle', 'what'], ['shareTitle', 'share'], ['rightsTitle', 'rights']].map(([h, p]) => html`<h2>${t(`privacy.${h}`)}</h2><p>${t(`privacy.${p}`)}</p>`)}
<p class="muted">${t('privacy.contact')}</p></div>`;
  return page({ ...ctx, path: '/privacy', title: `${t('privacy.title')} · Safiri`, description: t('privacy.intro'), body });
}

/** Trip, invite and pay links work inside the app; the web shows how to get there. */
function appOnly(ctx, appPath, path) {
  const { t } = ctx;
  const body = html`<div class="wrap"><h1>${t('web.appOnlyTitle')}</h1><p>${t('web.appOnlyBody')}</p>
<p><a class="btn secondary" href="${ctx.playStoreUrl}">${t('web.getApp')}</a></p></div>`;
  return page({ ...ctx, path, title: `${t('web.appOnlyTitle')} · Safiri`, description: t('web.appOnlyBody'), noindex: true, appPath, body });
}

/**
 * One-tap pay link, for travellers (and friends) without the app: one button sends the
 * M-PESA prompt. Works without JavaScript; never indexed.
 */
function payPage(ctx, { code, target, error }) {
  const { t } = ctx;
  const payable = target.bookingStatus === 'confirmed' && target.amountKes > 0;
  const body = html`<div class="wrap" style="max-width:520px">
<h1>${t('web.payTitle', { ref: target.ref })}</h1>
<p class="muted">${target.title || ''}</p>
${payable
    ? html`<p class="price">${t('web.payNext', { amount: formatKes(target.amountKes) })}</p>
<p class="muted">${t('web.payBalance', { amount: formatKes(target.balanceKes) })}</p>
${error ? html`<p style="color:#B42318"><strong>${t(error)}</strong></p>` : ''}
<form method="post" action="/pay/${code}${ctx.lang === 'sw' ? '?lang=sw' : ''}">
<label for="phone"><strong>${t('web.payPhone')}</strong></label><br>
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="${t('web.payPhoneHint', { phone: target.phone })}"
 style="width:100%;min-height:48px;font-size:16px;padding:8px 12px;margin:8px 0 16px;border:1px solid #8A8276;border-radius:8px">
<button class="btn" type="submit" style="border:0;width:100%;font-size:16px">${t('web.payButton')}</button>
</form>
<p class="muted">${t('web.payNoAppNeeded')}</p>`
    : html`<p>${target.bookingStatus === 'confirmed' || target.bookingStatus === 'fully_paid' ? t('web.payNothingDue') : t('web.payNotActive')}</p>`}
</div>`;
  return page({ ...ctx, path: `/pay/${code}`, title: `${t('web.payTitle', { ref: target.ref })} · Safiri`, description: t('web.payNoAppNeeded'), noindex: true, appPath: `pay/${code}`, body });
}

/**
 * After the prompt is sent: refreshes itself every 4 seconds until the payment settles.
 * basePath is the page that sent it (/pay/<code> or /i/<code>), for "try again".
 */
function payStatusPage(ctx, { basePath, payment }) {
  const { t } = ctx;
  const done = ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(payment.status);
  const message = payment.status === 'succeeded'
    ? (payment.receipt ? t('web.payPaid', { receipt: payment.receipt }) : t('web.payPaidNoReceipt'))
    : done ? t('web.payFailed') : t('web.payWaiting');
  const body = html`<div class="wrap" style="max-width:520px">
${done ? '' : raw('<meta http-equiv="refresh" content="4">')}
<p class="price">${formatKes(payment.amountKes)}</p>
<p role="status"><strong>${message}</strong></p>
${done && payment.status !== 'succeeded' ? html`<p><a class="btn" href="${basePath}${langQuery(ctx.lang)}">${t('web.tryAgain')}</a></p>` : ''}
</div>`;
  return page({ ...ctx, path: `${basePath}/status/${payment.paymentId}`, title: 'M-PESA · Safiri', description: message, noindex: true, body });
}

/** "2026-11-30" -> "30 Nov 2026", with Kiswahili month names on Kiswahili pages. */
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};
const longDate = (iso, lang) => `${Number(iso.slice(8, 10))} ${(MONTHS[lang] || MONTHS.en)[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** A friend's invite to a group trip: their share and one button to pay it. No app needed. */
function invitePage(ctx, { code, invite, error }) {
  const { t, lang } = ctx;
  const heading = t('web.inviteTitle', { organiser: invite.organiserName, title: invite.title || invite.ref });
  // Before confirmation the deadline is the hold (a time); after, the final due date (a date).
  const deadline = invite.deadline && invite.deadline.length === 10 ? longDate(invite.deadline, lang) : null;
  const body = html`<div class="wrap" style="max-width:520px">
<h1>${heading}</h1>
<p class="muted">${t('web.inviteBooking', { ref: invite.ref })}</p>
<p class="price">${t('web.inviteShare', { amount: formatKes(invite.shareKes) })}</p>
${invite.paidKes ? html`<p>${t('web.invitePaidSoFar', { amount: formatKes(invite.paidKes) })}</p>` : ''}
${invite.payable
    ? html`${deadline ? html`<p class="muted">${t('web.inviteDeadline', { date: deadline })}</p>` : ''}
${error ? html`<p style="color:#B42318"><strong>${t(error)}</strong></p>` : ''}
<form method="post" action="/i/${code}${langQuery(lang)}">
<label for="phone"><strong>${t('web.payPhone')}</strong></label><br>
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="${t('web.payPhoneHint', { phone: invite.phone })}"
 style="width:100%;min-height:48px;font-size:16px;padding:8px 12px;margin:8px 0 16px;border:1px solid #8A8276;border-radius:8px">
<button class="btn" type="submit" style="border:0;width:100%;font-size:16px">${t('checkout.pay', { amount: formatKes(invite.leftKes) })}</button>
</form>
<p class="muted">${t('web.payNoAppNeeded')}</p>`
    : html`<p><strong>${invite.leftKes === 0 ? t('web.inviteDone') : t('web.inviteClosed')}</strong></p>`}
</div>`;
  return page({ ...ctx, path: `/i/${code}`, title: `${heading} · Safiri`, description: t('web.payNoAppNeeded'), noindex: true, appPath: `i/${code}`, body });
}

function notFound(ctx, messageKey = 'web.notFound') {
  const { t, lang } = ctx;
  const body = html`<div class="wrap"><h1>${t(messageKey)}</h1><p><a class="btn" href="/${langQuery(lang)}">${t('web.backHome')}</a></p></div>`;
  return page({ ...ctx, path: '/404', title: `${t('web.notFound')} · Safiri`, description: t('web.notFound'), noindex: true, body });
}

module.exports = { home, destination, packagePage, privacy, appOnly, payPage, payStatusPage, invitePage, notFound };
