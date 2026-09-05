// Root ESLint config: covers scripts/ and packages/. Each app under apps/ has
// its own config (backend: typescript-eslint; mobile: eslint-config-expo) and
// is linted through its workspace `lint` script.
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', 'apps/**', 'coverage/**', '**/dist/**', '.playwright-mcp/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.{mjs,cjs,js}', 'packages/**/*.ts', '*.{mjs,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
