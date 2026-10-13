/**
 * Uploads the destination photos to the public Supabase Storage bucket in two widths:
 *   photos/<key>-1280.jpg  (from assets/images/backgrounds/<key>.jpg)
 *   photos/<key>-640.jpg   (from assets/images/backgrounds/640/<key>.jpg)
 * <key> is what destinations.hero_image / packages.hero_image hold, e.g. "naivasha-lake".
 *
 *   npm run photos:upload --workspace @safiri/api      (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
const fs = require('node:fs');
const path = require('node:path');
const { PHOTO_BUCKET } = require('@safiri/shared');
const { loadConfig } = require('../src/config');
const { createSupabaseAdmin } = require('../src/integrations/supabase');

const SOURCE = path.join(__dirname, '..', '..', 'mobile', 'assets', 'images', 'backgrounds');

async function main() {
  const config = loadConfig();
  const supabase = createSupabaseAdmin({ url: config.SUPABASE_URL, serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY });
  if (!supabase) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/api/.env');

  const keys = fs.readdirSync(SOURCE).filter((f) => f.endsWith('.jpg')).map((f) => f.replace(/\.jpg$/, ''));
  for (const key of keys) {
    for (const [width, file] of [[1280, path.join(SOURCE, `${key}.jpg`)], [640, path.join(SOURCE, '640', `${key}.jpg`)]]) {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(`photos/${key}-${width}.jpg`, fs.readFileSync(file), {
        contentType: 'image/jpeg',
        cacheControl: '31536000', // a year: names never change; upload under a new key to replace
        upsert: true,
      });
      if (error) throw new Error(`${key}-${width}: ${error.message}`);
      console.log(`uploaded photos/${key}-${width}.jpg`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
