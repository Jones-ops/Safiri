/**
 * Destination and package photos from the public Storage bucket. Lists and data-saver mode
 * use the 640px file; full-width heroes use 1280px unless data saver is on.
 */
import { photoUrl } from '@safiri/shared';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

export function photoSource(key, { hero = false, lowData = false } = {}) {
  const uri = photoUrl(SUPABASE_URL, key, hero && !lowData ? 1280 : 640);
  return uri ? { uri, cacheKey: `${key}-${hero && !lowData ? 1280 : 640}` } : null;
}

/** Public web address for sharing, e.g. https://safiri.example/p/naivasha-lakeside-weekend */
export function webUrl(path) {
  const base = (process.env.EXPO_PUBLIC_WEB_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}
