import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraphService } from '../src/index.js';

describe('CodeGraphService', () => {
  let service: CodeGraphService;
  beforeEach(() => { service = new CodeGraphService(); });

  it('computes AST diff for added methods', async () => {
    const proposal = {
      diffs: [{
        filePath: 'src/UserService.ts', operation: 'modify' as const, language: 'typescript',
        diffContent: '+  public async createUser(dto: CreateUserDto): Promise<User> {\n+    return this.repo.save(dto);\n+  }',
      }],
      summary: 'test', testFilePaths: [],
    };
    const result = await service.computeAstDiff('.', proposal);
    expect(result.semanticChanges.some(c => c.kind === 'method_added' && c.symbolName === 'createUser')).toBe(true);
    expect(result.breakingChangeCount).toBe(0);
  });

  it('detects breaking change for removed public method', async () => {
    const proposal = {
      diffs: [{ filePath: 'src/Api.ts', operation: 'modify' as const, language: 'typescript', diffContent: '-  public findById(id: string): Promise<User> {\n-    return this.db.find(id);\n-  }' }],
      summary: 'test', testFilePaths: [],
    };
    const result = await service.computeAstDiff('.', proposal);
    expect(result.breakingChangeCount).toBeGreaterThan(0);
  });

  it('selectAffectedTests matches by filename stem', async () => {
    const changed = ['src/UserService.ts'];
    const tests   = ['src/UserService.test.ts', 'src/OrderService.test.ts', 'src/Email.test.ts'];
    const selected = await service.selectAffectedTests(changed, tests);
    expect(selected).toContain('src/UserService.test.ts');
    expect(selected).not.toContain('src/Email.test.ts');
  });

  it('blast radius includes changed files', async () => {
    const blast = await service.getBlastRadius(['src/UserService.ts']);
    expect(blast.entryFiles).toContain('src/UserService.ts');
    expect(blast.riskScore).toBeGreaterThanOrEqual(0);
    expect(blast.riskScore).toBeLessThanOrEqual(10);
  });
});
