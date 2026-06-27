import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/memory/vitest.config.ts',
  'packages/code-graph/vitest.config.ts',
  'packages/visual-testing/vitest.config.ts',
  'packages/contracts/vitest.config.ts',
  'packages/language-plugins/base/vitest.config.ts',
  'packages/language-plugins/typescript/vitest.config.ts',
  'packages/language-plugins/java/vitest.config.ts',
  'packages/providers/claude/vitest.config.ts',
  'packages/providers/docker/vitest.config.ts',
  'packages/cli/vitest.config.ts',
  'packages/debugger/vitest.config.ts',
]);
