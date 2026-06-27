import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@tacv/core/observability': path.resolve('./src/observability/index.ts'),
      '@tacv/core/interfaces':    path.resolve('./src/interfaces/index.ts'),
      '@tacv/core/state':         path.resolve('./src/state/index.ts'),
      '@tacv/debugger':           path.resolve('../debugger/src/index.ts'),
    },
  },
  test: {
    globals: true, environment: 'node',
    coverage: { provider: 'v8', reporter: ['text','json','html'], thresholds: { lines: 80, functions: 80, branches: 70 }, exclude: ['**/tests/**','**/*.d.ts'] },
    testTimeout: 30_000,
  },
});
