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

  it('still advances to TDD_GATE even when plan has structural warnings', async () => {
    // Plan with high complexity + many risky areas triggers PLAN_HIGH_RISK
    const riskyPlan = {
      ...minimalPlan,
      estimatedComplexity: 'high' as const,
      riskyAreas: ['area1', 'area2', 'area3', 'area4'],
    };
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => riskyPlan as never };
    const result = await implementationPlanImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('TDD_GATE');
    expect(result.implementationPlan?.criticsApproved).toBe(false);
    expect(result.implementationPlan?.fastCriticFindings.some(f => f.ruleId === 'PLAN_HIGH_RISK')).toBe(true);
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

  describe('plan structural validation (Bug 5: replaces dead diffProposal check)', () => {
    const brownfieldTask = {
      taskId: 'plan-bf', description: 'Fix login bug',
      mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
    };

    it('flags BROWNFIELD plans touching too many files as PLAN_TOO_BROAD', async () => {
      const widePlan = {
        ...minimalPlan,
        filesToCreate: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts', 'src/j.ts', 'src/k.ts'],
        filesToModify: ['src/x.ts', 'src/y.ts'],
      };
      const deps = makeStubDeps();
      deps.extractor = { extract: async () => widePlan as never };
      const result = await implementationPlanImpl(createInitialState(brownfieldTask), deps);
      const findings = result.implementationPlan?.fastCriticFindings ?? [];
      expect(findings.some(f => f.ruleId === 'PLAN_TOO_BROAD')).toBe(true);
    });

    it('flags high complexity + many risky areas as PLAN_HIGH_RISK', async () => {
      const riskyPlan = {
        ...minimalPlan,
        estimatedComplexity: 'high' as const,
        riskyAreas: ['area1', 'area2', 'area3', 'area4'],
      };
      const deps = makeStubDeps();
      deps.extractor = { extract: async () => riskyPlan as never };
      const result = await implementationPlanImpl(createInitialState(brownfieldTask), deps);
      const findings = result.implementationPlan?.fastCriticFindings ?? [];
      expect(findings.some(f => f.ruleId === 'PLAN_HIGH_RISK')).toBe(true);
    });

    it('flags plan with source files but no test files as PLAN_NO_TEST_FILES', async () => {
      const noTestPlan = {
        ...minimalPlan,
        testFilesToCreate: [],
      };
      const deps = makeStubDeps();
      deps.extractor = { extract: async () => noTestPlan as never };
      const result = await implementationPlanImpl(createInitialState(brownfieldTask), deps);
      const findings = result.implementationPlan?.fastCriticFindings ?? [];
      expect(findings.some(f => f.ruleId === 'PLAN_NO_TEST_FILES')).toBe(true);
    });

    it('sets criticsApproved=false when structural warnings exist', async () => {
      const deps = makeStubDeps();
      deps.extractor = { extract: async () => ({ ...minimalPlan, testFilesToCreate: [] }) as never };
      const result = await implementationPlanImpl(createInitialState(brownfieldTask), deps);
      expect(result.implementationPlan?.criticsApproved).toBe(false);
    });
  });
});
