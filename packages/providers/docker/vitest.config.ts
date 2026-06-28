import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@tacv/core/observability': path.resolve(__dirname, '../../core/src/observability/index.ts'),
      '@tacv/core/interfaces':    path.resolve(__dirname, '../../core/src/interfaces/index.ts'),
      '@tacv/core/state':         path.resolve(__dirname, '../../core/src/state/index.ts'),
    },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
    },
  },
  test: {
    globals:     true,
    environment: 'node',
    coverage: {
      provider:   'v8',
      reporter:   ['text', 'json', 'html', 'lcov'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
      exclude:    ['**/tests/**', '**/*.d.ts'],
    },
    testTimeout: 30_000,
    reporters:   ['verbose'],
  },
});
