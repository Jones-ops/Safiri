/** Server-side strings for the public pages, from the same en/sw files as the app. */
const { i18n } = require('@safiri/shared');

const LANGS = ['en', 'sw'];

/** ?lang=sw wins; otherwise the browser's Accept-Language; otherwise English. */
function pickLanguage(request) {
  const q = request.query?.lang;
  if (LANGS.includes(q)) return q;
  const accept = String(request.headers['accept-language'] || '').toLowerCase();
  return /(^|,)\s*sw\b/.test(accept) ? 'sw' : 'en';
}

function translator(lang) {
  const strings = i18n.resources[lang]?.translation || i18n.en;
  return function t(key, vars = {}) {
    const value = key.split('.').reduce((o, k) => (o == null ? o : o[k]), strings) ??
      key.split('.').reduce((o, k) => (o == null ? o : o[k]), i18n.en);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] ?? ''));
  };
}

/** Kiswahili text from a row's `sw` column when the page is in Kiswahili. */
function localised(row, field, lang) {
  return (lang === 'sw' && row.sw && row.sw[field]) || row[field];
}

module.exports = { pickLanguage, translator, localised, LANGS };
