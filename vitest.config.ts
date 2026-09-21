import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/model/**',
        'src/store/merge.ts',
        'src/store/usage.ts',
        'src/context/relevance.ts',
        'src/context/frecency.ts',
        'src/context/ordering.ts',
        'src/runner/variables.ts',
        'src/runner/danger.ts',
        'src/discovery/parsers.ts',
        'src/importers/**',
        'src/ui/editor/html.ts',
      ],
    },
  },
});
