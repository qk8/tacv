import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true, environment: 'node',
    coverage: { provider: 'v8', reporter: ['text','json','html'], thresholds: { lines: 85, functions: 85, branches: 75 }, exclude: ['**/tests/**','**/*.d.ts'] },
    testTimeout: 30_000,
  },
});
