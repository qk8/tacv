import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: {
    alias: {
      '@tacv/core/state':       path.resolve(__dirname, '../core/src/state/index.ts'),
      '@tacv/core/interfaces':  path.resolve(__dirname, '../core/src/interfaces/index.ts'),
      '@tacv/core/observability': path.resolve(__dirname, '../core/src/observability/index.ts'),
    },
  },
  test: {
    globals: true, environment: 'node',
    coverage: { provider: 'v8', reporter: ['text','json','html'], thresholds: { lines: 80, functions: 80, branches: 70 }, exclude: ['**/tests/**','**/*.d.ts'] },
    testTimeout: 30_000,
  },
});
