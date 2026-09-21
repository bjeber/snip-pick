import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Server-only modules, and the libraries that make a module server-only.
 *
 * esbuild bundles the extension from its import graph, so one import of any of these is enough to
 * pull a database driver into dist/extension.js. The build asserts the result too
 * (apps/extension/esbuild.mjs); this list is what reports the mistake at the import itself.
 */
const SERVER_ONLY = {
  group: [
    '@snip-pick/auth',
    '@snip-pick/auth-verify',
    '@snip-pick/config',
    '@snip-pick/db',
    '@snip-pick/api',
    'better-auth',
    'better-auth/*',
    '@better-auth/*',
    'drizzle-orm',
    'drizzle-orm/*',
    'drizzle-kit',
    'pg',
    'hono',
    'hono/*',
  ],
  message:
    'Server-only. The extension is bundled from its import graph, so this would ship a database driver inside the VSIX.',
};

/** Node built-ins, banned in the packages that have to run in a web extension host as well. */
const NODE_BUILTINS = {
  group: ['node:*'],
  message: 'This package must run in a web extension host too. Use a platform-neutral API.',
};

/** The editor API, banned everywhere except the extension itself. */
const VSCODE = {
  name: 'vscode',
  message: 'Shared packages and the API must not depend on the VS Code API.',
};

/**
 * eslint REPLACES a rule's options when two matching config objects both set it, rather than
 * merging them — so the last block matching a file is the only one that applies. Every block
 * below therefore restates everything that file is banned from, and this helper is what keeps
 * the restatements from drifting.
 */
const restrict = ({ paths = [], patterns = [] }) => ({
  'no-restricted-imports': ['error', { paths, patterns }],
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vscode-test/**',
      '**/drizzle/**',
    ],
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
    // Server code must not reach for the editor API. It is what lets the model, the sync client
    // and the server share one contract, and what keeps all three testable.
    files: ['packages/**/*.ts', 'apps/api/**/*.ts'],
    rules: restrict({ paths: [VSCODE] }),
  },
  {
    // ...and the extension must not reach for the server. It legitimately imports vscode, so
    // this is the one place the editor API is allowed.
    files: ['apps/extension/**/*.ts'],
    rules: restrict({ patterns: [SERVER_ONLY] }),
  },
  {
    // The sync client talks to the server over HTTP; it does not link against it.
    files: ['packages/api-client/**/*.ts'],
    rules: restrict({ paths: [VSCODE], patterns: [SERVER_ONLY] }),
  },
  {
    // The isomorphic packages carry no platform at all, so they stay usable from a web extension
    // host. packages/core/src/platform.d.ts is the one place that names a global.
    files: ['packages/contracts/**/*.ts', 'packages/core/**/*.ts'],
    rules: restrict({ paths: [VSCODE], patterns: [SERVER_ONLY, NODE_BUILTINS] }),
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
