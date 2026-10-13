/**
 * A catalogue service built from supabase/seed/data.js (the same data the database is seeded
 * with), in the shape services/catalogue.js returns. Lets the web pages be tested offline.
 */
const data = require('../../../../supabase/seed/data');
const { packagePrice } = require('../../../../supabase/seed/generate');

const DEFAULT_POLICY = [
  { days_before: 30, refund_pct: 100 },
  { days_before: 14, refund_pct: 50 },
  { days_before: 0, refund_pct: 0 },
];

function destination(key) {
  const d = data.destinations[key];
  return {
    slug: d.slug, name: d.name, region: d.region, lat: d.lat, lng: d.lng, summary: d.summary, bestTime: d.bestTime,
    gettingThere: d.gettingThere, faq: d.faq, heroImage: d.heroImage, sw: d.sw, updatedAt: '2026-10-13T00:00:00Z',
  };
}

function summary(key, overrides = {}) {
  const p = { ...data.packages[key], ...overrides };
  return {
    slug: p.slug, title: p.title, summary: p.summary, nights: p.nights, fromPriceKes: packagePrice(p).totalKes,
    depositPct: p.depositPct, instalments: p.instalments, finalDueDays: 7, heroImage: data.destinations[p.destination].heroImage,
    sw: {}, destination: { slug: data.destinations[p.destination].slug, name: data.destinations[p.destination].name },
    updatedAt: '2026-10-13T00:00:00Z',
  };
}

function detail(key, overrides = {}) {
  const p = { ...data.packages[key], ...overrides };
  const reviews = Object.values(data.bookings)
    .filter((b) => b.pkg === key && b.review)
    .map((b) => ({ rating: b.review.rating, body: b.review.body, createdAt: '2026-09-15T08:00:00Z' }));
  return {
    ...summary(key, overrides),
    destination: destination(p.destination),
    inclusions: p.inclusions,
    exclusions: p.exclusions,
    cancelPolicy: DEFAULT_POLICY,
    agency: { name: data.agency.name, licenceNo: data.agency.licenceNo },
    items: p.items.map(([listingKey, day, qty]) => {
      const l = data.listings[listingKey];
      const pr = data.providers[l.provider];
      return {
        day, qty, title: l.title, kind: l.kind, unit: l.unit,
        provider: { name: pr.name, type: pr.type, licenceNo: pr.licenceNo, verifiedAt: '2026-09-01T00:00:00Z', lat: null, lng: null },
      };
    }),
    reviews,
  };
}

/** @param {{ overrides?: Record<string, object> }} options per-package field overrides (e.g. a hostile title) */
function seedCatalogue({ overrides = {} } = {}) {
  const published = Object.keys(data.packages).filter((k) => data.packages[k].status !== 'draft');
  return {
    listDestinations: async () => Object.keys(data.destinations).map(destination).sort((a, b) => a.name.localeCompare(b.name)),
    listPackages: async () => published.map((k) => summary(k, overrides[k])).sort((a, b) => a.fromPriceKes - b.fromPriceKes),
    getDestination: async (slug) => {
      const key = Object.keys(data.destinations).find((k) => data.destinations[k].slug === slug);
      return key ? destination(key) : null;
    },
    getPackage: async (slug) => {
      const key = published.find((k) => data.packages[k].slug === slug);
      return key ? detail(key, overrides[key]) : null;
    },
  };
}

module.exports = { seedCatalogue };
