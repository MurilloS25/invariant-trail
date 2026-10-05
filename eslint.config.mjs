import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.claude/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules ?? {},
  },
  { files: ['apps/web/**/*.tsx'], ...jsxA11y.flatConfigs.recommended },
  {
    // The engine is a pure domain: no DOM, no clock, no randomness, no network.
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'fetch',
          'navigator',
          'location',
          'XMLHttpRequest',
          'Worker',
        ].map((name) => ({ name, message: 'The engine must stay independent from browser APIs.' })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'No hidden nondeterminism.' },
        { object: 'Date', property: 'now', message: 'State must not depend on wall-clock time.' },
        { object: 'performance', property: 'now', message: 'State must not depend on time.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'No wall-clock time in the engine.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'packages/engine/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
