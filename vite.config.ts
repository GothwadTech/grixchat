import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

/**
 * MOCK_SUPABASE=1 swaps `@supabase/supabase-js` for the local in-memory mock
 * in dev/mock/, so the whole app runs with zero credentials and zero network.
 * See docs/DEV_SETUP.md.
 */
const MOCK = process.env.MOCK_SUPABASE === '1' || process.env.MOCK_SUPABASE === 'true';

/**
 * Vendor splitting (KNOWN_ISSUES #12): without `manualChunks` firebase,
 * livekit, supabase and everything else landed in one 1.14 MB entry chunk.
 * Only the named heavyweights are pulled out — everything else is left to
 * Rollup's own graph so module init order stays intact.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;

  const inPackage = (pkg: string) => id.includes(`/node_modules/${pkg}/`);
  const inScope = (scope: string) => id.includes(`/node_modules/${scope}/`);

  if (inPackage('firebase') || inScope('@firebase')) return 'vendor-firebase';
  if (inPackage('livekit-client') || inScope('@livekit')) return 'vendor-livekit';
  if (inScope('@supabase')) return 'vendor-supabase';
  if (inPackage('emoji-picker-react')) return 'vendor-emoji';
  if (
    inPackage('react') ||
    inPackage('react-dom') ||
    inPackage('scheduler') ||
    inPackage('react-router') ||
    inPackage('react-router-dom')
  ) {
    return 'vendor-react';
  }
  if (inPackage('motion') || inPackage('framer-motion')) return 'vendor-motion';
  if (inPackage('lucide-react')) return 'vendor-icons';
  if (inScope('@google')) return 'vendor-genai';
  return undefined;
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const isProductionBuild = mode === 'production';

  /**
   * Loud guard for a silent failure mode: `src/lib/supabase.ts` rejects a
   * client without both values, and Rollup constant-folds that early return
   * into `null` — which tree-shakes the *entire* Supabase SDK out of the
   * bundle. The build still "succeeds"; the app just can never reach the
   * backend. Say so at build time instead.
   */
  if (isProductionBuild && !MOCK && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    console.warn(
      [
        '',
        '='.repeat(78),
        '⚠  GrixChat: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set for this',
        '   build. The Supabase client will be compiled out and the deployed app will',
        '   not be able to sign in or load any data.',
        '   Provide them via .env or the build environment (see .env.example).',
        '   For a credential-free local build use: npm run build:mock',
        '='.repeat(78),
        '',
      ].join('\n')
    );
  }

  return {
    base: process.env.VITE_BASE_URL || '/',
    plugins: [react(), tailwindcss()],
    esbuild: {
      // ~350 console.* calls shipped to production (KNOWN_ISSUES #14). Dropped
      // from the production bundle only, so dev keeps its logging.
      drop: isProductionBuild ? ['console', 'debugger'] : [],
    },
    build: {
      // The largest remaining chunk is `vendor-livekit` (~527 kB), which is
      // fetched only when a call starts and deliberately not split further.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {manualChunks},
      },
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // The mock ignores these, but src/lib/supabase.ts returns null when they
      // are missing — so inject placeholders to let the client initialise.
      ...(MOCK
        ? {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || 'http://mock.supabase.grixchat.local'),
            'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || 'mock-anon-key'),
            'import.meta.env.VITE_MOCK_SUPABASE': JSON.stringify('1'),
          }
        : {}),
    },
    resolve: {
      alias: MOCK
        ? [
            {find: '@supabase/supabase-js', replacement: path.resolve(__dirname, 'dev/mock/index.ts')},
            {find: '@', replacement: path.resolve(__dirname, '.')},
          ]
        : {
            '@': path.resolve(__dirname, '.'),
          },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    preview: {
      host: '0.0.0.0',
    },
  };
});
