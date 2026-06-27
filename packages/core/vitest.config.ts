import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      exclude: ['**/tests/**', '**/*.d.ts', '**/index.ts'],
    },
    testTimeout: 60_000,
    reporters: ['verbose'],
    server: {
      deps: {
        inline: ['pino', 'pino-pretty', '@opentelemetry/api'],
      },
    },
  },
});
