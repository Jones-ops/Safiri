/**
 * Adds strings to packages/shared/src/i18n/{en,sw}.json from a JSON file of the shape
 * { en: { section: { key: text } }, sw: { ... } }. Sections merge; existing keys are replaced.
 *   node scripts/add-strings.js path/to/strings.json
 */
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2];
if (!file) throw new Error('Usage: add-strings <json file>');
const add = JSON.parse(fs.readFileSync(file, 'utf8'));
const dir = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'i18n');

for (const lang of ['en', 'sw']) {
  const p = path.join(dir, `${lang}.json`);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const [section, values] of Object.entries(add[lang] || {})) {
    data[section] = { ...(data[section] || {}) };
    for (const [key, value] of Object.entries(values)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) data[section][key] = { ...(data[section][key] || {}), ...value };
      else data[section][key] = value;
    }
  }
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}
console.log('strings added');
