// ESLint flat config. `npm run lint:eslint` runs this; `npm run lint` is tsc.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist', '.wrangler', 'node_modules', 'coverage', 'public', 'docs', 'sql', 'dev/mock/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: false }],
      ...jsxA11y.flatConfigs.recommended.rules,
      // Backlog (see docs/ROCK_SOLID.md §Accessibility): these need design or
      // caption assets before they can become errors. Visible as warnings.
      'jsx-a11y/media-has-caption': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Server, Pages Functions, scripts and tests may use console directly:
    // their output is the platform log, not the in-app developer console.
    files: ['server.ts', 'server/**', 'functions/**', 'vite.config.ts', 'vitest.config.ts', 'src/**/__tests__/**', 'dev/**', 'src/utils/logger.ts', 'src/services/ConsoleLoggerService.ts'],
    rules: { 'no-console': 'off' },
  },
);
