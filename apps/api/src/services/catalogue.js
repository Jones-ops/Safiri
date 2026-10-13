/**
 * Public catalogue for the web pages: published packages, their destinations, items,
 * providers and reviews. Uses the service-role client, which BYPASSES RLS, so every query
 * filters to public data explicitly (published packages, verified providers, published reviews).
 * Results are cached in memory for a minute: pages stay fast and Supabase stays quiet.
 */

const CACHE_MS = 60 * 1000;

const DESTINATION_COLUMNS = 'slug, name, region, lat, lng, summary, best_time, getting_there, faq, hero_image, sw, updated_at';
const PACKAGE_BASE =
  'slug, title, summary, nights, from_price_kes, deposit_pct, instalments, final_due_days, hero_image, sw, updated_at';
const PACKAGE_COLUMNS = `${PACKAGE_BASE}, destination:destinations!inner(slug, name)`;
const PACKAGE_DETAIL_COLUMNS = [
  PACKAGE_BASE,
  `destination:destinations!inner(${DESTINATION_COLUMNS})`,
  'inclusions, exclusions, cancel_policy',
  'agency:agencies(name, licence_no, verified_at)',
  'items:package_items(day, qty, listing:listings(title, kind, unit, active, provider:providers(name, type, licence_no, verified_at, lat, lng)))',
  'reviews(rating, body, created_at, status)',
].join(', ');

function toDestination(row) {
  return {
    slug: row.slug,
    name: row.name,
    region: row.region,
    lat: Number(row.lat),
    lng: Number(row.lng),
    summary: row.summary,
    bestTime: row.best_time,
    gettingThere: row.getting_there,
    faq: row.faq || [],
    heroImage: row.hero_image,
    sw: row.sw ? { summary: row.sw.summary, bestTime: row.sw.bestTime, gettingThere: row.sw.gettingThere, faq: row.sw.faq } : {},
    updatedAt: row.updated_at,
  };
}

function toPackageSummary(row) {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    nights: row.nights,
    fromPriceKes: row.from_price_kes,
    depositPct: row.deposit_pct,
    instalments: row.instalments,
    finalDueDays: row.final_due_days,
    heroImage: row.hero_image,
    sw: row.sw || {},
    destination: { slug: row.destination.slug, name: row.destination.name },
    updatedAt: row.updated_at,
  };
}

function createCatalogue(supabase) {
  const cache = new Map();
  async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await load();
    cache.set(key, { value, until: Date.now() + CACHE_MS });
    return value;
  }

  function db() {
    if (!supabase) throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    return supabase;
  }

  async function run(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  return {
    listDestinations: () =>
      cached('destinations', async () =>
        (await run(db().from('destinations').select(DESTINATION_COLUMNS).order('name'))).map(toDestination)),

    listPackages: () =>
      cached('packages', async () =>
        (await run(db().from('packages').select(PACKAGE_COLUMNS).eq('status', 'published').order('from_price_kes')))
          .map(toPackageSummary)),

    getDestination: (slug) =>
      cached(`destination:${slug}`, async () => {
        const row = await run(db().from('destinations').select(DESTINATION_COLUMNS).eq('slug', slug).maybeSingle());
        return row ? toDestination(row) : null;
      }),

    getPackage: (slug) =>
      cached(`package:${slug}`, async () => {
        const row = await run(
          db()
            .from('packages')
            .select(PACKAGE_DETAIL_COLUMNS)
            .eq('slug', slug)
            .eq('status', 'published')
            .maybeSingle(),
        );
        if (!row) return null;
        const items = (row.items || [])
          .filter((i) => i.listing?.active && i.listing.provider?.verified_at) // public only
          .sort((a, b) => a.day - b.day)
          .map((i) => ({
            day: i.day,
            qty: i.qty,
            title: i.listing.title,
            kind: i.listing.kind,
            unit: i.listing.unit,
            provider: {
              name: i.listing.provider.name,
              type: i.listing.provider.type,
              licenceNo: i.listing.provider.licence_no,
              verifiedAt: i.listing.provider.verified_at,
              lat: i.listing.provider.lat == null ? null : Number(i.listing.provider.lat),
              lng: i.listing.provider.lng == null ? null : Number(i.listing.provider.lng),
            },
          }));
        return {
          ...toPackageSummary(row),
          destination: toDestination(row.destination),
          inclusions: row.inclusions || [],
          exclusions: row.exclusions || [],
          cancelPolicy: row.cancel_policy || [],
          agency: row.agency ? { name: row.agency.name, licenceNo: row.agency.licence_no } : null,
          items,
          reviews: (row.reviews || [])
            .filter((r) => r.status === 'published')
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((r) => ({ rating: r.rating, body: r.body, createdAt: r.created_at })),
        };
      }),
  };
}

module.exports = { createCatalogue };
