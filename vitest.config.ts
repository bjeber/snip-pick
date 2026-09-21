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
      include: [
        'packages/core/src/**',
        'packages/api-client/src/**',
        'apps/extension/src/ui/editor/html.ts',
        'apps/api/src/**',
      ],
      exclude: ['**/index.ts', 'apps/api/src/db/schema.ts'],
    },
  },
});
