import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: {
    alias: {
      '@tacv/core/observability': path.resolve(__dirname, '../core/src/observability/index.ts'),
      '@tacv/core/interfaces':    path.resolve(__dirname, '../core/src/interfaces/index.ts'),
      '@tacv/core/state':         path.resolve(__dirname, '../core/src/state/index.ts'),
    },
  },
  test: { globals: true, environment: 'node', testTimeout: 30_000 },
});
