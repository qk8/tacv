/**
 * Tests for the new structural query contracts on ILanguagePlugin.
 * These tests work against a minimal stub that verifies the interface shape.
 */
import { describe, it, expect } from 'vitest';
import type {
  ILanguagePlugin, IStackParser, DebugAdapterSpec, LanguageSyntaxInfo,
} from '../src/index.js';
import type { ErrorType } from '@tacv/contracts';

// ── Minimal conformant stub ───────────────────────────────────────────────────
function makeConformantPlugin(overrides: Partial<ILanguagePlugin> = {}): ILanguagePlugin {
  const syntaxInfo: LanguageSyntaxInfo = {
    controllerFilePattern:  /Controller\.(ts|java)$/,
    dependencyManifestFile: 'package.json',
    packageEcosystem:       'npm',
    testFilePattern:        /\.(test|spec)\.(ts|js)$/,
    publicMethodPattern:    /export\s+(?:async\s+)?function\s+(\w+)/gm,
    classPattern:           /class\s+(\w+)/gm,
    defaultApplicationPort: 3000,
  };
  const stackParser: IStackParser = {
    parseAndPrune: (_raw, _mod) => [],
  };
  const debugSpec: DebugAdapterSpec = {
    protocol: 'cdp',
    defaultPort: 9229,
    launchCmdTemplate: 'node --inspect-brk=0.0.0.0:${port}',
  };

  return {
    metadata: { languageId: 'test', displayName: 'Test', extensions: ['.test'] as const, testFramework: 'vitest', buildTool: 'tsc' },
    build:                async () => ({ success: true, errors: [], warnings: [], durationMs: 0 }),
    typeCheck:            async () => ({ violations: [], durationMs: 0 }),
    runProtectionTests:   async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], coverageReport: null, durationMs: 0 }),
    runAcceptanceTests:   async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], coverageReport: null, durationMs: 0 }),
    runApiTests:          async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: 0 }),
    runMutationTests:     async () => ({ mutationScore: 100, totalMutants: 0, killedMutants: 0, survivedMutants: 0, weakTestFiles: [], durationMs: 0 }),
    runBenchmarks:        async () => ({ benchmarks: [] }),
    generateTestSkeleton: async (_f, _c) => ({ testFilePath: 'test.ts', testContent: '', framework: 'vitest' }),
    lint:                 async () => ({ violations: [], durationMs: 0 }),
    format:               async (c) => c,
    checkArchRules:       async () => ({ violations: [], durationMs: 0 }),
    detectDeletedTests:   () => [],
    getDebugAdapterSpec:  () => debugSpec,
    getSyntaxInfo:        () => syntaxInfo,
    getErrorPatterns:     () => [],
    createStackParser:    () => stackParser,
    getProfileFor:        () => null,
    ...overrides,
  } as unknown as ILanguagePlugin;
}

describe('ILanguagePlugin — getSyntaxInfo()', () => {
  it('returns a LanguageSyntaxInfo with all required fields', () => {
    const plugin = makeConformantPlugin();
    const info = plugin.getSyntaxInfo();
    expect(info).toHaveProperty('controllerFilePattern');
    expect(info).toHaveProperty('dependencyManifestFile');
    expect(info).toHaveProperty('packageEcosystem');
    expect(info).toHaveProperty('testFilePattern');
    expect(info).toHaveProperty('publicMethodPattern');
    expect(info).toHaveProperty('classPattern');
    expect(info).toHaveProperty('defaultApplicationPort');
  });

  it('controllerFilePattern can be null (some languages have no concept)', () => {
    const plugin = makeConformantPlugin({
      getSyntaxInfo: () => ({
        controllerFilePattern: null,
        dependencyManifestFile: 'Cargo.toml',
        packageEcosystem: 'cargo',
        testFilePattern: /_test\.rs$/,
        publicMethodPattern: /pub fn (\w+)/gm,
        classPattern: /struct (\w+)/gm,
        defaultApplicationPort: 8080,
      }) as LanguageSyntaxInfo,
    });
    expect(plugin.getSyntaxInfo().controllerFilePattern).toBeNull();
  });

  it('testFilePattern matches test files correctly', () => {
    const plugin = makeConformantPlugin();
    const pattern = plugin.getSyntaxInfo().testFilePattern;
    expect(pattern.test('UserService.test.ts')).toBe(true);
    expect(pattern.test('UserService.spec.js')).toBe(true);
    expect(pattern.test('UserService.ts')).toBe(false);
  });

  it('defaultApplicationPort is a positive integer', () => {
    const port = makeConformantPlugin().getSyntaxInfo().defaultApplicationPort;
    expect(port).toBeGreaterThan(0);
    expect(Number.isInteger(port)).toBe(true);
  });
});

describe('ILanguagePlugin — getErrorPatterns()', () => {
  it('returns an array (can be empty)', () => {
    expect(makeConformantPlugin().getErrorPatterns()).toBeInstanceOf(Array);
  });

  it('each entry is [RegExp[], ErrorType]', () => {
    const plugin = makeConformantPlugin({
      getErrorPatterns: (): Array<[RegExp[], ErrorType]> => [
        [[/NullPointerException/], 'NULL_REFERENCE'],
        [[/BeanCreationException/], 'BEAN_CREATION_ERROR'],
      ],
    });
    const patterns = plugin.getErrorPatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.[0]).toBeInstanceOf(Array);
    expect(patterns[0]?.[0][0]).toBeInstanceOf(RegExp);
    expect(patterns[0]?.[1]).toBe('NULL_REFERENCE');
  });

  it('patterns are matched in order — first match wins', () => {
    const plugin = makeConformantPlugin({
      getErrorPatterns: (): Array<[RegExp[], ErrorType]> => [
        [[/NPE/], 'NULL_REFERENCE'],
        [[/Error/], 'LOGIC_ERROR'],
      ],
    });
    const rawOutput = 'NPE: null Error';
    const patterns = plugin.getErrorPatterns();
    let matched: ErrorType = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(rawOutput))) { matched = type; break; }
    }
    expect(matched).toBe('NULL_REFERENCE');
  });
});

describe('ILanguagePlugin — createStackParser()', () => {
  it('returns an IStackParser with parseAndPrune', () => {
    const parser = makeConformantPlugin().createStackParser();
    expect(typeof parser.parseAndPrune).toBe('function');
  });

  it('parseAndPrune accepts rawOutput and moduleType', () => {
    const parser = makeConformantPlugin().createStackParser({ userRoot: 'src' });
    const frames = parser.parseAndPrune('some stack trace', 'backend');
    expect(Array.isArray(frames)).toBe(true);
  });

  it('each frame has file, line, method, isUser', () => {
    const plugin = makeConformantPlugin({
      createStackParser: () => ({
        parseAndPrune: () => [{ file: 'Foo.ts', line: 10, method: 'bar', isUser: true }],
      }),
    });
    const frame = plugin.createStackParser().parseAndPrune('', 'backend')[0];
    expect(frame?.file).toBe('Foo.ts');
    expect(frame?.line).toBe(10);
    expect(frame?.isUser).toBe(true);
  });
});

describe('ILanguagePlugin — getDebugAdapterSpec()', () => {
  it('returns DebugAdapterSpec or null', () => {
    const spec = makeConformantPlugin().getDebugAdapterSpec();
    expect(spec).not.toBeNull();
    if (spec !== null) {
      expect(['cdp', 'jdwp', 'dap', 'none']).toContain(spec.protocol);
      expect(spec.defaultPort).toBeGreaterThan(0);
      expect(typeof spec.launchCmdTemplate).toBe('string');
    }
  });

  it('can return null for languages without debug support', () => {
    const plugin = makeConformantPlugin({ getDebugAdapterSpec: () => null });
    expect(plugin.getDebugAdapterSpec()).toBeNull();
  });

  it('launchCmdTemplate contains ${port} substitution marker', () => {
    const spec = makeConformantPlugin().getDebugAdapterSpec()!;
    expect(spec.launchCmdTemplate).toContain('${port}');
  });
});

describe('LanguagePluginRegistry — getForExtension()', () => {
  it('returns plugin by extension string', async () => {
    const { LanguagePluginRegistry } = await import('../src/LanguagePluginRegistry.js');
    const registry = new LanguagePluginRegistry();
    registry.register(makeConformantPlugin());
    expect(registry.getForExtension('.test')?.metadata.languageId).toBe('test');
  });

  it('returns null for unknown extension', async () => {
    const { LanguagePluginRegistry } = await import('../src/LanguagePluginRegistry.js');
    const registry = new LanguagePluginRegistry();
    expect(registry.getForExtension('.rs')).toBeNull();
  });
});
