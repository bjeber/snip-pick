import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', 'coverage/**', '.vscode-test/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      curly: ['error', 'multi-line'],
      'no-console': 'error',
    },
  },
  {
    files: ['src/model/**/*.ts', 'src/importers/**/*.ts'],
    rules: {
      // Pure modules must stay free of the vscode API so they can be unit-tested.
      'no-restricted-imports': ['error', { paths: ['vscode'] }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
