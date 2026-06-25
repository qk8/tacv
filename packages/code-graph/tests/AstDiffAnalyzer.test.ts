import { describe, it, expect } from 'vitest';
import { AstDiffAnalyzer } from '../src/analyzers/AstDiffAnalyzer.js';

const analyzer = new AstDiffAnalyzer();

describe('AstDiffAnalyzer', () => {
  it('detects added TypeScript function', async () => {
    const result = await analyzer.analyze('.', {
      diffs: [{ filePath: 'src/users.ts', operation: 'modify', diffContent: '+export async function createUser(dto: CreateUserDto): Promise<User> {\n+  return repo.save(dto);\n+}', language: 'typescript' }],
      summary: 'test', testFilePaths: [],
    });
    expect(result.semanticChanges.some(c => c.kind === 'method_added' && c.symbolName === 'createUser')).toBe(true);
    expect(result.breakingChangeCount).toBe(0);
  });

  it('detects removed public Java method as high-risk breaking change', async () => {
    const result = await analyzer.analyze('.', {
      diffs: [{ filePath: 'src/UserService.java', operation: 'modify', diffContent: '- public User findById(Long id) {\n-   return repo.findById(id).orElseThrow();\n- }', language: 'java' }],
      summary: 'test', testFilePaths: [],
    });
    expect(result.breakingChangeCount).toBeGreaterThan(0);
    expect(result.semanticChanges.some(c => c.breakingRisk === 'high')).toBe(true);
  });

  it('returns zero changes for non-code diff', async () => {
    const result = await analyzer.analyze('.', {
      diffs: [{ filePath: 'README.md', operation: 'modify', diffContent: '+ ## New section\n+ Some text', language: 'markdown' }],
      summary: 'test', testFilePaths: [],
    });
    expect(result.semanticChanges).toHaveLength(0);
  });

  it('counts safe vs breaking correctly', async () => {
    const result = await analyzer.analyze('.', {
      diffs: [{ filePath: 'src/api.ts', operation: 'modify', diffContent: '+export function newHelper() {}\n-export function oldPublicApi() {}', language: 'typescript' }],
      summary: 'test', testFilePaths: [],
    });
    expect(result.safeChangeCount).toBeGreaterThanOrEqual(0);
    expect(result.breakingChangeCount + result.safeChangeCount).toBe(result.semanticChanges.length);
  });

  it('handles create operation', async () => {
    const result = await analyzer.analyze('.', {
      diffs: [{ filePath: 'src/NewService.ts', operation: 'create', diffContent: '+export class NewService {\n+  process() {}\n+}', language: 'typescript' }],
      summary: 'test', testFilePaths: [],
    });
    expect(result.semanticChanges.some(c => c.kind === 'class_added')).toBe(true);
  });
});
