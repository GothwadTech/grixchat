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

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: process.env.VITE_BASE_URL || '/',
    plugins: [react(), tailwindcss()],
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
