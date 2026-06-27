import { describe, it, expect, vi } from 'vitest';
import { compatibilityCritic } from '../../../../src/activities/critics/compatibilityCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';

const brownfieldBase = { taskId: 't1', description: 'd', mode: 'BROWNFIELD' as const, moduleType: 'b', languageIds: ['java'] };

// ── Plugin stubs ─────────────────────────────────────────────────────────────
function makePluginStub(languageId: 'java' | 'typescript') {
  const info = languageId === 'java'
    ? {
        controllerFilePattern:  /(Controller|Resource)\.java$/,
        dependencyManifestFile: 'pom.xml', packageEcosystem: 'maven' as const,
        testFilePattern:        /(Test|IT)\.java$/,
        publicMethodPattern:    /public\s+[\w<>\[\]]+\s+(\w+)\s*\(/gm,
        classPattern:           /class\s+(\w+)/gm, defaultApplicationPort: 8080,
      }
    : {
        controllerFilePattern:  /\/(routes|controllers)\/.*\.ts$/,
        dependencyManifestFile: 'package.json', packageEcosystem: 'npm' as const,
        testFilePattern:        /\.(test|spec)\.(ts|js)$/,
        publicMethodPattern:    /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/gm,
        classPattern:           /class\s+(\w+)/gm, defaultApplicationPort: 3000,
      };
  return { metadata: { languageId }, getSyntaxInfo: () => info };
}

function makeDeps(languageId: 'java' | 'typescript' = 'java') {
  const plugin = makePluginStub(languageId);
  return {
    log: { info: vi.fn() },
    pluginRegistry: { get: (id: string) => makePluginStub(id as 'java' | 'typescript') },
  } as any;
}

const makeState = (diffContent: string, mode: 'GREENFIELD' | 'BROWNFIELD' = 'BROWNFIELD', filePath = 'src/UserService.java', lang: 'java' | 'typescript' = 'java') => ({
  ...createInitialState({ ...brownfieldBase, mode, languageIds: [lang] }),
  diffProposal: { diffs: [{ filePath, operation: 'modify' as const, diffContent, language: lang }], summary: '', testFilePaths: [] },
});

describe('compatibilityCritic', () => {
  it('returns empty in GREENFIELD mode', async () => {
    const state = makeState('- public User findById(String id) {', 'GREENFIELD');
    expect(await compatibilityCritic(state, makeDeps())).toHaveLength(0);
  });

  it('detects deleted public Java method', async () => {
    const f = await compatibilityCritic(makeState('- public User findById(String id) {'), makeDeps());
    expect(f.some(x => x.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(true);
  });

  it('does not flag deleted private method', async () => {
    const f = await compatibilityCritic(makeState('- private void validate(String s) {'), makeDeps());
    expect(f.some(x => x.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(false);
  });

  it('detects field rename in Java entity', async () => {
    const diff = `- private String userName;\n+ private String username;`;
    const state = {
      ...createInitialState(brownfieldBase),
      diffProposal: { diffs: [{ filePath: 'src/UserEntity.java', operation: 'modify' as const, diffContent: diff, language: 'java' }], summary: '', testFilePaths: [] },
    };
    const f = await compatibilityCritic(state, makeDeps());
    expect(f.some(x => x.ruleId === 'SCHEMA_MIGRATION_REQUIRED')).toBe(true);
  });

  it('detects deleted TS exported function', async () => {
    const state = makeState('- export function getUser() {', 'BROWNFIELD', 'src/api.ts', 'typescript');
    const f = await compatibilityCritic(state, makeDeps('typescript'));
    expect(f.some(x => x.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(true);
  });

  it('returns empty when diffProposal is null', async () => {
    const state = { ...createInitialState(brownfieldBase), diffProposal: null };
    expect(await compatibilityCritic(state, makeDeps())).toHaveLength(0);
  });

  it('skips create operations', async () => {
    const state = {
      ...createInitialState(brownfieldBase),
      diffProposal: { diffs: [{ filePath: 'src/New.java', operation: 'create' as const, diffContent: '+ public void newMethod() {}', language: 'java' }], summary: '', testFilePaths: [] },
    };
    expect(await compatibilityCritic(state, makeDeps())).toHaveLength(0);
  });

  it('uses critic name compatibility', async () => {
    const f = await compatibilityCritic(makeState('- public User getUser() {'), makeDeps());
    f.forEach(x => expect(x.critic).toBe('compatibility'));
  });

  it('severity is critical for breaking change', async () => {
    const f = await compatibilityCritic(makeState('- public User getUser() {'), makeDeps());
    const breaking = f.filter(x => x.ruleId === 'NO_DELETE_PUBLIC_API');
    expect(breaking.every(x => x.severity === 'critical')).toBe(true);
  });
});
