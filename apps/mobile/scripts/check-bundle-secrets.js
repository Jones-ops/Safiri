/**
 * Definition of done: "no secrets in the app bundle". Scans an `expo export` output folder
 * for anything that must only live on the API: the Supabase service-role key, Daraja and
 * WhatsApp credentials, webhook secrets, Africa's Talking keys.
 *
 *   node scripts/check-bundle-secrets.js dist
 *
 * Exits 1 and names the file and pattern if anything is found. Run in CI after every export.
 */
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(process.argv[2] || 'dist');

// Names that only the API's environment should contain. Seeing one in the bundle means a
// secret was referenced from app code (or an EXPO_PUBLIC_ variable was misnamed).
const FORBIDDEN_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SEND_SMS_HOOK_SECRET',
  'DARAJA_CONSUMER_SECRET',
  'DARAJA_PASSKEY',
  'DARAJA_B2C_SECURITY_CREDENTIAL',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'AT_API_KEY',
  'SENTRY_AUTH_TOKEN',
];

// A real key is the prefix plus a long random run (mixed case and digits). supabase-js itself
// contains the bare text "sb_secret_", and Hermes packs strings back to back, so the run
// must look random, not like the next identifier in the string table.
const looksRandom = (s) => s.length >= 24 && /[0-9]/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);

const PATTERNS = [
  {
    name: 'Supabase secret key',
    test: (text) => [...text.matchAll(/sb_secret_([A-Za-z0-9_-]{24,})/g)].some((m) => looksRandom(m[1])),
  },
  { name: 'Standard Webhooks secret', re: /whsec_[A-Za-z0-9+/=]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: "Africa's Talking key", re: /atsk_[a-f0-9]{20,}/ },
];

/** Legacy Supabase keys are JWTs; the anon one is fine, a service_role one is not. */
function serviceRoleJwts(text) {
  const found = [];
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (claims.role === 'service_role') found.push('JWT with role=service_role');
    } catch {
      // not a JWT
    }
  }
  return found;
}

function* files(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(js|hbc|json|map|txt|html)$/.test(entry.name)) yield full;
  }
}

if (!fs.existsSync(dir)) {
  console.error(`No export folder at ${dir}. Run \`npm run export:android\` first.`);
  process.exit(2);
}

const problems = [];
let scanned = 0;
for (const file of files(dir)) {
  scanned += 1;
  // Hermes bytecode keeps string literals readable, so a latin1 read finds them.
  const text = fs.readFileSync(file, 'latin1');
  for (const name of FORBIDDEN_NAMES) if (text.includes(name)) problems.push([file, name]);
  for (const p of PATTERNS) if (p.test ? p.test(text) : p.re.test(text)) problems.push([file, p.name]);
  for (const hit of serviceRoleJwts(text)) problems.push([file, hit]);
}

if (problems.length) {
  console.error('Secrets found in the app bundle:');
  for (const [file, what] of problems) console.error(`  ${path.relative(dir, file)}: ${what}`);
  process.exit(1);
}
console.log(`No secrets found in ${scanned} bundle files.`);
