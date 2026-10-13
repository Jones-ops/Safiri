/** English and Kiswahili strings. A native speaker reviews sw.json before launch. */
const en = require('./en.json');
const sw = require('./sw.json');

const resources = { en: { translation: en }, sw: { translation: sw } };

/** Every key path in a strings file, e.g. "auth.sendCode". Used by the parity test. */
function keyPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? keyPaths(value, path) : [path];
  });
}

module.exports = { resources, en, sw, keyPaths };
