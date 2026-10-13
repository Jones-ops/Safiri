/**
 * Builds test/fixtures/schemaorg-subset.json from the official schema.org vocabulary:
 * for each type our pages use (and every parent type), the properties it accepts.
 * The JSON-LD test uses it to catch what the Schema.org validator reports as errors
 * (unknown types, properties a type doesn't accept). Re-run when we use a new type.
 *
 *   npm run schema:refresh --workspace @safiri/api
 */
const fs = require('node:fs');
const path = require('node:path');

const VOCAB_URL = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'schemaorg-subset.json');

// Every @type the public pages emit.
const TYPES = [
  'WebSite', 'WebPage', 'Organization', 'TravelAgency', 'Product', 'TouristTrip', 'Offer',
  'AggregateRating', 'Review', 'Rating', 'Person', 'LodgingBusiness', 'PostalAddress',
  'GeoCoordinates', 'FAQPage', 'Question', 'Answer', 'BreadcrumbList', 'ListItem', 'ItemList',
  'TouristDestination', 'Place', 'Brand', 'QuantitativeValue', 'ImageObject',
];

const strip = (id) => String(id).replace(/^schema:/, '');
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function main() {
  const res = await fetch(VOCAB_URL);
  if (!res.ok) throw new Error(`schema.org returned HTTP ${res.status}`);
  const graph = (await res.json())['@graph'];

  const parents = {};
  const propsByType = {};
  for (const node of graph) {
    const kinds = asArray(node['@type']);
    const id = strip(node['@id']);
    if (kinds.includes('rdfs:Class')) {
      parents[id] = asArray(node['rdfs:subClassOf']).map((p) => strip(p['@id']));
    }
    if (kinds.includes('rdf:Property') && !node['schema:supersededBy']) {
      for (const d of asArray(node['schema:domainIncludes'])) {
        (propsByType[strip(d['@id'])] ||= []).push(id);
      }
    }
  }

  // Close over parent types so inherited properties are included.
  const wanted = new Set();
  const visit = (t) => {
    if (wanted.has(t)) return;
    if (!parents[t]) throw new Error(`Unknown schema.org type: ${t}`);
    wanted.add(t);
    parents[t].filter((p) => parents[p]).forEach(visit);
  };
  TYPES.forEach(visit);

  const subset = {
    source: VOCAB_URL,
    generated: new Date().toISOString().slice(0, 10),
    types: Object.fromEntries(
      [...wanted].sort().map((t) => [t, { parents: parents[t].filter((p) => parents[p]), properties: (propsByType[t] || []).sort() }]),
    ),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(subset, null, 1) + '\n');
  console.log(`Wrote ${wanted.size} types to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
