// Fail-fast environment check, run before every production build (`prebuild`).
//
// A build without the Supabase values produces a site that loads and then fails
// on every screen. Stopping the build here is louder and cheaper. Set
// ALLOW_MISSING_ENV=1 for a deliberate placeholder build.
import { existsSync, readFileSync } from 'node:fs';

if (process.env.MOCK_SUPABASE === '1' || process.env.ALLOW_MISSING_ENV === '1') {
  console.log('[check-env] skipped (mock build or ALLOW_MISSING_ENV=1).');
  process.exit(0);
}

// Vite reads .env files too; mirror its precedence closely enough for a presence check.
function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const fileEnv = Object.assign({}, readDotEnv('.env'), readDotEnv('.env.production'), readDotEnv('.env.local'));
const value = (key) => process.env[key] || fileEnv[key] || '';

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
// Optional features: the build still succeeds, but the feature is off.
const OPTIONAL = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_VAPID_KEY', 'VITE_LIVEKIT_URL',
];

const missingRequired = REQUIRED.filter((k) => !value(k));
const missingOptional = OPTIONAL.filter((k) => !value(k));

if (missingOptional.length) {
  console.warn(`[check-env] optional, feature disabled without: ${missingOptional.join(', ')}`);
}
if (missingRequired.length) {
  console.error(`[check-env] FAILED. Missing required build variables: ${missingRequired.join(', ')}`);
  console.error('[check-env] Set them in the environment (Cloudflare Pages → Settings → Variables) or in .env.production.');
  console.error('[check-env] To build a placeholder deliberately, set ALLOW_MISSING_ENV=1.');
  process.exit(1);
}
console.log('[check-env] required build variables present.');
