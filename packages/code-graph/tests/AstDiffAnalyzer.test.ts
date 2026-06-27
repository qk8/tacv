import { describe, it, expect } from 'vitest';
import { AstDiffAnalyzer } from '../src/analyzers/AstDiffAnalyzer.js';
import type { ILanguagePlugin, LanguageSyntaxInfo } from '@tacv/language-plugins-base';
import { LanguagePluginRegistry } from '@tacv/language-plugins-base';

// ── Minimal plugin stubs ──────────────────────────────────────────────────────
function makeJavaPlugin(): ILanguagePlugin {
  return {
    metadata:    { languageId: 'java', displayName: 'Java', extensions: ['.java'], testFramework: 'JUnit 5', buildTool: 'Maven' },
    getSyntaxInfo: (): LanguageSyntaxInfo => ({
      controllerFilePattern: /(Controller|Resource)\.java$/, dependencyManifestFile: 'pom.xml',
      packageEcosystem: 'maven', testFilePattern: /(Test|IT)\.java$/,
      publicMethodPattern:    /public\s+[\w<>\[\]]+\s+(\w+)\s*\(/gm,
      classPattern:           /class\s+(\w+)/gm, defaultApplicationPort: 8080,
    }),
  } as unknown as ILanguagePlugin;
}

function makeTsPlugin(): ILanguagePlugin {
  return {
    metadata: { languageId: 'typescript', displayName: 'TypeScript', extensions: ['.ts', '.tsx'], testFramework: 'vitest', buildTool: 'tsc' },
    getSyntaxInfo: (): LanguageSyntaxInfo => ({
      controllerFilePattern: /\/(routes|controllers)\/.*\.ts$/, dependencyManifestFile: 'package.json',
      packageEcosystem: 'npm', testFilePattern: /\.(test|spec)\.(ts|tsx|js)$/,
      publicMethodPattern:    /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/gm,
      classPattern:           /class\s+(\w+)/gm, defaultApplicationPort: 3000,
    }),
  } as unknown as ILanguagePlugin;
}

function makeRegistry(): LanguagePluginRegistry {
  const reg = new LanguagePluginRegistry();
  reg.register(makeJavaPlugin());
  reg.register(makeTsPlugin());
  return reg;
}

describe('AstDiffAnalyzer — plugin-delegated symbol extraction', () => {
  const registry = makeRegistry();

  it('detects removed Java public method as high breaking risk', async () => {
    const analyzer = new AstDiffAnalyzer(registry);
    const result = await analyzer.analyze('/repo', {
      diffs: [{ filePath: 'UserService.java', operation: 'modify', diffContent: '- public User findById(Long id) {\n+   throw new UnsupportedOperationException();\n- }' }],
      summary: '', testFilePaths: [],
    });
    const removed = result.semanticChanges.filter(c => c.kind === 'method_removed');
    expect(removed.some(c => c.symbolName === 'findById')).toBe(true);
    expect(removed.find(c => c.symbolName === 'findById')?.breakingRisk).toBe('high');
  });

  it('detects added TS exported function as no breaking risk', async () => {
    const analyzer = new AstDiffAnalyzer(registry);
    const result = await analyzer.analyze('/repo', {
      diffs: [{ filePath: 'api.ts', operation: 'modify', diffContent: '+ export function newHelper() {}' }],
      summary: '', testFilePaths: [],
    });
    const added = result.semanticChanges.filter(c => c.kind === 'method_added');
    expect(added.some(c => c.symbolName === 'newHelper')).toBe(true);
    expect(added.find(c => c.symbolName === 'newHelper')?.breakingRisk).toBe('none');
  });

  it('falls back gracefully for unknown file extension', async () => {
    const analyzer = new AstDiffAnalyzer(registry);
    const result = await analyzer.analyze('/repo', {
      diffs: [{ filePath: 'main.rs', operation: 'modify', diffContent: '- pub fn old_func() {}' }],
      summary: '', testFilePaths: [],
    });
    // Should not throw; returns empty or partial results
    expect(result.semanticChanges).toBeInstanceOf(Array);
  });

  it('works without a registry (backward compat — uses built-in patterns)', async () => {
    const analyzer = new AstDiffAnalyzer(); // no registry
    const result = await analyzer.analyze('/repo', {
      diffs: [{ filePath: 'Service.java', operation: 'modify', diffContent: '- public void doWork() {}' }],
      summary: '', testFilePaths: [],
    });
    expect(result.semanticChanges).toBeInstanceOf(Array);
  });

  it('breakingChangeCount equals high+medium risk changes', async () => {
    const analyzer = new AstDiffAnalyzer(registry);
    const result = await analyzer.analyze('/repo', {
      diffs: [
        { filePath: 'Svc.java', operation: 'modify', diffContent: '- public void methodA() {}\n+ public void methodB() {}' },
      ],
      summary: '', testFilePaths: [],
    });
    const high = result.semanticChanges.filter(c => c.breakingRisk === 'high' || c.breakingRisk === 'medium').length;
    expect(result.breakingChangeCount).toBe(high);
  });
});
