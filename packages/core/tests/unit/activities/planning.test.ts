import { describe, it, expect } from 'vitest';
import { implementationPlanImpl } from '../../../src/activities/planning/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = {
  taskId: 'plan-1', description: 'Add user authentication with JWT',
  mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
};

const minimalPlan = {
  planSummary: 'Implement JWT auth',
  filesToCreate: ['src/auth/JwtService.ts'],
  filesToModify: ['src/user/UserController.ts'],
  filesToDelete: [],
  testFilesToCreate: ['src/auth/JwtService.test.ts'],
  estimatedComplexity: 'medium' as const,
  riskyAreas: ['token expiry handling'],
};

describe('implementationPlanImpl', () => {
  it('creates an implementation plan from extractor', async () => {
    const deps = makeStubDeps();
    deps.extractor = {
      extract: async () => minimalPlan as never,
    };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    expect(result.implementationPlan).not.toBeNull();
    expect(result.implementationPlan?.planSummary).toBe('Implement JWT auth');
    expect(result.implementationPlan?.filesToCreate).toContain('src/auth/JwtService.ts');
  });

  it('advances to TDD_GATE on success', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => minimalPlan as never };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('TDD_GATE');
  });

  it('marks criticsApproved=true when no fast-critic findings', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => minimalPlan as never };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    expect(result.implementationPlan?.criticsApproved).toBe(true);
    expect(result.implementationPlan?.fastCriticFindings).toHaveLength(0);
  });

  it('still advances to TDD_GATE even when plan has critic warnings', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => minimalPlan as never };
    // style critic finds a lint warning — should not block planning
    const origPlugin = deps.pluginRegistry.get('typescript');
    const lintOverride = {
      ...origPlugin,
      lint: async () => ({ violations: [{ file: 'src/auth/JwtService.ts', line: 5, ruleId: 'no-console', message: 'console.log', resolutionHint: 'use logger' }] }),
    } as never;
    deps.pluginRegistry = {
      get: () => lintOverride,
      getForFile: () => lintOverride,
    };
    const state = {
      ...createInitialState(task),
      diffProposal: {
        diffs: [{ filePath: 'src/auth/JwtService.ts', operation: 'create' as const, diffContent: '+ console.log("hi")', language: 'typescript' }],
        summary: 'auth', testFilePaths: [],
      },
    };
    const result = await implementationPlanImpl(state, deps);
    expect(result.currentPhase).toBe('TDD_GATE');
    expect(result.implementationPlan?.criticsApproved).toBe(false);
    expect(result.implementationPlan?.fastCriticFindings.length).toBeGreaterThan(0);
  });

  it('skips planning and goes straight to TDD_GATE when disabled', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, planning: { enabled: false, validateWithFastCritics: true, model: 'claude-haiku-4-5-20251001' } };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    expect(result.implementationPlan).toBeNull();
    expect(result.currentPhase).toBe('TDD_GATE');
  });

  it('defaults to TDD_GATE even when extractor throws', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => { throw new Error('LLM timeout'); } };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('TDD_GATE');
    expect(result.implementationPlan).toBeNull();
  });

  it('stores the plan in an audit trail entry', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => minimalPlan as never };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    const entry = result.workflowAuditTrail.find(e => e.node === 'implementation_plan');
    expect(entry).toBeDefined();
    expect(entry?.decision).toBe('plan_created');
  });
});
