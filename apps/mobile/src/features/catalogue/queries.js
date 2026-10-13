/**
 * Catalogue reads straight from Supabase with the publishable key. RLS decides what is
 * visible: published packages, verified providers, published reviews. Results are cached on
 * the phone (TanStack persisted cache), so Explore opens instantly and works offline.
 */
import { useQuery } from '@tanstack/react-query';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

const PACKAGE_BASE = 'slug, title, summary, nights, from_price_kes, deposit_pct, instalments, final_due_days, hero_image, sw';
const LIST_COLUMNS = `${PACKAGE_BASE}, destination:destinations!inner(slug, name)`;

const DETAIL_COLUMNS = [
  PACKAGE_BASE,
  'destination:destinations!inner(slug, name, region, faq, sw)',
  'inclusions, exclusions, cancel_policy',
  'agency:agencies(name, licence_no)',
  'items:package_items(day, qty, listing:listings(title, kind, unit, provider:providers(name, type, licence_no, verified_at)))',
  'reviews(rating, body, created_at, status)',
].join(', ');

const DESTINATION_COLUMNS = 'slug, name, region, summary, best_time, getting_there, faq, hero_image, sw';

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export const toPackage = (row) => ({
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
  destination: row.destination,
});

const toDestination = (row) => ({
  slug: row.slug,
  name: row.name,
  region: row.region,
  summary: row.summary,
  bestTime: row.best_time,
  gettingThere: row.getting_there,
  faq: row.faq || [],
  heroImage: row.hero_image,
  sw: row.sw || {},
});

function toPackageDetail(row) {
  return {
    ...toPackage(row),
    inclusions: row.inclusions || [],
    exclusions: row.exclusions || [],
    cancelPolicy: row.cancel_policy || [],
    agency: row.agency,
    destination: { ...row.destination, faq: row.destination.faq || [], sw: row.destination.sw || {} },
    // RLS hides listings of unverified providers: the embed comes back null, so drop those.
    items: (row.items || [])
      .filter((i) => i.listing?.provider)
      .sort((a, b) => a.day - b.day)
      .map((i) => ({ day: i.day, qty: i.qty, title: i.listing.title, kind: i.listing.kind, provider: i.listing.provider })),
    reviews: (row.reviews || [])
      .filter((r) => r.status === 'published')
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

const enabled = isSupabaseConfigured;

export function usePackages() {
  return useQuery({
    queryKey: ['packages'],
    enabled,
    queryFn: async () =>
      (await run(supabase.from('packages').select(LIST_COLUMNS).eq('status', 'published').order('from_price_kes'))).map(toPackage),
  });
}

export function useDestinations() {
  return useQuery({
    queryKey: ['destinations'],
    enabled,
    queryFn: async () => (await run(supabase.from('destinations').select(DESTINATION_COLUMNS).order('name'))).map(toDestination),
  });
}

export function useDestination(slug) {
  return useQuery({
    queryKey: ['destination', slug],
    enabled: enabled && Boolean(slug),
    queryFn: async () => {
      const row = await run(supabase.from('destinations').select(DESTINATION_COLUMNS).eq('slug', slug).maybeSingle());
      return row ? toDestination(row) : null;
    },
  });
}

export function usePackage(slug) {
  return useQuery({
    queryKey: ['package', slug],
    enabled: enabled && Boolean(slug),
    queryFn: async () => {
      const row = await run(supabase.from('packages').select(DETAIL_COLUMNS).eq('slug', slug).eq('status', 'published').maybeSingle());
      return row ? toPackageDetail(row) : null;
    },
  });
}

/** Kiswahili text from a row's `sw` column when the app is in Kiswahili. */
export function localised(row, field, language) {
  return (language === 'sw' && row?.sw?.[field]) || row?.[field];
}
