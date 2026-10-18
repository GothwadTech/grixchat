import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vitest/config';

/**
 * Test config. Mirrors the MOCK_SUPABASE alias from vite.config.ts so tests
 * always run against dev/mock/ — never against a live Supabase project.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // src/lib/supabase.ts refuses to build a client without these, even though
    // the mock ignores both values.
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://mock.supabase.grixchat.local'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('mock-anon-key'),
    'import.meta.env.VITE_MOCK_SUPABASE': JSON.stringify('1'),
  },
  resolve: {
    alias: [
      {find: '@supabase/supabase-js', replacement: path.resolve(__dirname, 'dev/mock/index.ts')},
      {find: '@', replacement: path.resolve(__dirname, '.')},
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // The smoke test drives a real login + realtime hydration, which involves
    // several async round trips through the React tree.
    testTimeout: 25000,
    hookTimeout: 15000,
    setupFiles: ['./dev/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'dev/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Measured on the shipped code, minus the mock backend and tests. Thresholds
      // sit just under today's numbers so coverage can only go up.
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.d.ts', 'src/main.tsx'],
      thresholds: {
        lines: 15,
        functions: 40,
        statements: 15,
        branches: 50,
      },
    },
  },
});
