import { describe, it, expect } from 'vitest';
import { LanguagePluginRegistry, PluginNotFoundError } from '../src/LanguagePluginRegistry.js';

/**
 * Issue 17: LanguagePluginRegistry.get() throws with no graceful fallback.
 *
 * The error message should help users understand how to fix the problem
 * (install the plugin package and register it).
 */

describe('Issue 17: LanguagePluginRegistry error message is helpful', () => {
  it('includes available plugin IDs in the error message', () => {
    const registry = new LanguagePluginRegistry();
    registry.register({
      metadata: { languageId: 'typescript', displayName: 'TypeScript', extensions: ['.ts'], testFramework: 'vitest', buildTool: 'tsc' },
      build: async () => ({ success: true, errors: [], warnings: [], durationMs: 0 }),
      typeCheck: async () => ({ violations: [], durationMs: 0 }),
      runProtectionTests: async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: 0 }),
      runAcceptanceTests: async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: 0 }),
      runApiTests: async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: 0 }),
      runMutationTests: async () => ({ mutationScore: 80, totalMutants: 10, killedMutants: 8, survivedMutants: 2, weakTestFiles: [], durationMs: 0 }),
      runBenchmarks: async () => ({ benchmarks: [] }),
      generateTestSkeleton: async () => ({ testFilePath: '', testContent: '', framework: '' }),
      lint: async () => ({ violations: [], durationMs: 0 }),
      format: async () => '',
      checkArchRules: async () => ({ violations: [], durationMs: 0 }),
      detectDeletedTests: () => [],
      getProfileFor: () => null,
      getSyntaxInfo: () => ({ controllerFilePattern: null, dependencyManifestFile: 'package.json', packageEcosystem: 'npm', testFilePattern: /\.test\.ts$/, publicMethodPattern: /test/g, classPattern: /class/g, defaultApplicationPort: 3000 }),
      getErrorPatterns: () => [],
      createStackParser: () => ({ parseAndPrune: () => [] }),
      getDebugAdapterSpec: () => null,
    });

    let error: PluginNotFoundError | null = null;
    try { registry.get('python'); } catch (e) { if (e instanceof PluginNotFoundError) error = e; }

    expect(error).toBeDefined();
    expect(error?.message).toContain('python');
    expect(error?.message).toContain('typescript');
  });

  it('includes installation hint for unregistered languages', () => {
    const registry = new LanguagePluginRegistry();

    let error: PluginNotFoundError | null = null;
    try { registry.get('rust'); } catch (e) { if (e instanceof PluginNotFoundError) error = e; }

    expect(error).toBeDefined();
    // Should suggest installing the plugin package
    expect(error?.message).toContain('@tacv/plugin');
  });
});
