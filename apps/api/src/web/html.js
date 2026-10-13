/**
 * A tiny template engine: html`...` escapes every interpolated value unless it is wrapped
 * in raw() or is the result of another html`` call. Arrays are joined. No client JS needed.
 */

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s) => String(s).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new SafeHtml(out);
}

const raw = (s) => new SafeHtml(String(s));

// Built from char codes so no editor or tool turns them into literal line breaks.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * JSON-LD script tag. "<" is escaped so a value can never close the script element; the
 * Unicode line and paragraph separators are escaped too (they are valid JSON, invalid JS).
 */
function jsonLdScript(data) {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029');
  return raw(`<script type="application/ld+json">${json}</script>`);
}

module.exports = { html, raw, escape, jsonLdScript, SafeHtml };
