import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
      exclude: ['**/tests/**', '**/*.d.ts', '**/index.ts'],
    },
    testTimeout: 60_000,
    reporters: ['verbose'],
  },
});
