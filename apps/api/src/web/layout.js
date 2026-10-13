/**
 * Page shell for the public web layer: fast on 3G (inline CSS, no JS, lazy images),
 * bilingual (hreflang), light/dark, and with the "open in the app" button.
 */
const { html, raw, jsonLdScript } = require('./html');

// Same tokens as the app (apps/mobile/src/theme/tokens.js).
const CSS = `
:root{--bg:#FAF6EF;--surface:#FFF;--text:#1C1A16;--muted:#5F584D;--primary:#1F5C46;--on-primary:#FFF;--soft:#E3EFE8;--accent:#E8913A;--on-accent:#1C1A16;--divider:#E6DFD3}
@media (prefers-color-scheme:dark){:root{--bg:#121110;--surface:#1C1B19;--text:#F4EFE6;--muted:#B3AB9E;--primary:#6CC19A;--on-primary:#0E1F17;--soft:#1E3A2E;--accent:#F0A35E;--on-accent:#121110;--divider:#2E2C28}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Roboto,"Segoe UI",sans-serif}
a{color:var(--primary)}img{max-width:100%;display:block}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
header.site{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;max-width:960px;margin:0 auto}
header.site a.brand{font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;color:var(--text)}
.hero{position:relative;color:#fff;background:#1F5C46}
.hero img{width:100%;height:clamp(220px,45vw,420px);object-fit:cover}
.hero .scrim{position:absolute;inset:0;background:linear-gradient(transparent 20%,rgba(18,17,16,.75))}
.hero .text{position:absolute;left:0;right:0;bottom:0;padding:16px;max-width:960px;margin:0 auto}
.hero h1{margin:0 0 4px;font-size:28px;line-height:34px}
h2{font-size:22px;line-height:28px;margin:32px 0 12px}h3{font-size:18px;margin:16px 0 8px}
.muted{color:var(--muted)}.price{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.badge{display:inline-block;background:var(--accent);color:var(--on-accent);border-radius:999px;padding:2px 12px;font-size:14px;font-weight:500}
.verified{display:inline-block;background:var(--soft);color:var(--primary);border-radius:999px;padding:2px 10px;font-size:14px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:var(--surface);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.card img{aspect-ratio:16/9;object-fit:cover;width:100%}.card .body{padding:16px}
.card h3{margin:4px 0 8px}
.btn{display:inline-block;min-height:48px;padding:12px 24px;border-radius:8px;background:var(--primary);color:var(--on-primary);text-decoration:none;font-weight:600}
.btn.secondary{background:transparent;color:var(--primary);border:1.5px solid var(--primary)}
.chips a{display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:999px;background:var(--soft);color:var(--primary);text-decoration:none;font-weight:500}
ol.plan{padding-left:20px}ol.plan li{margin-bottom:8px}
table.pay{border-collapse:collapse;width:100%;max-width:480px}table.pay td{padding:8px 0;border-bottom:1px solid var(--divider)}table.pay td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.sticky{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between}
details{background:var(--surface);border-radius:8px;padding:12px 16px;margin-bottom:8px}summary{cursor:pointer;font-weight:600}
blockquote{margin:0 0 12px;padding:12px 16px;background:var(--surface);border-radius:8px}
footer{margin-top:48px;padding:24px 16px;border-top:1px solid var(--divider);color:var(--muted);font-size:14px}
`.replace(/\n/g, '');

/**
 * @param {{ base, path, lang, t, title, description, image?, jsonLd?, body, noindex?, appPath? }} p
 * appPath: the in-app route (e.g. "p/naivasha-lakeside-weekend") for the open-in-app button.
 */
function page(p) {
  const url = `${p.base}${p.path}`;
  const langUrl = (lang) => (lang === 'en' ? url : `${url}?lang=${lang}`);
  const otherLang = p.lang === 'en' ? 'sw' : 'en';
  const canonical = langUrl(p.lang);

  return html`<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.description}">
<link rel="canonical" href="${canonical}">
${p.noindex ? raw('<meta name="robots" content="noindex">') : html`<link rel="alternate" hreflang="en" href="${langUrl('en')}">
<link rel="alternate" hreflang="sw" href="${langUrl('sw')}">
<link rel="alternate" hreflang="x-default" href="${url}">`}
<meta property="og:type" content="website">
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.description}">
<meta property="og:url" content="${canonical}">
${p.image ? html`<meta property="og:image" content="${p.image}">` : ''}
<meta name="theme-color" content="#1F5C46">
<style>${raw(CSS)}</style>
${p.jsonLd ? jsonLdScript(p.jsonLd) : ''}
</head>
<body>
<header class="site">
  <a class="brand" href="${p.lang === 'en' ? '/' : '/?lang=sw'}">Safiri</a>
  <a href="${langUrl(otherLang)}" hreflang="${otherLang}" lang="${otherLang}">${p.t('web.switchLanguage')}</a>
</header>
<main>${p.body}</main>
${p.appPath ? appBar(p) : ''}
<footer><div class="wrap">${p.t('web.allPrices')} · <a href="/privacy${p.lang === 'sw' ? '?lang=sw' : ''}">${p.t('web.privacy')}</a></div></footer>
</body>
</html>`;
}

/** "Open in the app" (Android intent with Play Store fallback) for in-app browsers like WhatsApp's. */
function appBar(p) {
  const fallback = encodeURIComponent(p.playStoreUrl);
  const intent = `intent://${p.appPath}#Intent;scheme=safiri;package=${p.androidPackage};S.browser_fallback_url=${fallback};end`;
  return html`<div class="sticky">${p.stickyLeft || ''}<a class="btn" href="${intent}">${p.t('web.openInApp')}</a></div>`;
}

module.exports = { page };
