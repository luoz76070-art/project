import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', 'dist-*/**', 'output/**', 'generated-protocol/**', 'apps/mobile/android/**', '.trellis/**', '.agents/**', '.codex/**'] },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'apps/*/*.ts', 'apps/*/scripts/**/*.mjs', 'apps/relay/tests/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-debugger': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unsafe-finally': 'error',
      'no-async-promise-executor': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  {
    files: ['apps/mobile/src/features/chat/{runtimeSync,sync}.ts'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used' }] },
  },
];
