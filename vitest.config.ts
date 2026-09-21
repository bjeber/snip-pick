import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/extension/test/unit/**/*.test.ts',
      'apps/api/test/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/extension/src/ui/editor/html.ts', 'apps/api/src/**'],
      exclude: [
        '**/index.ts',
        '**/*.d.ts',
        // Table definitions and generated better-auth schema: shape, not behaviour.
        'packages/db/src/schema.ts',
        'packages/db/src/auth-schema.ts',
      ],
    },
  },
});
