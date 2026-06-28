import { describe, it, expect } from 'vitest';
import { buildCompressedActorPrompt } from '../../../src/activities/actor/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import type { WorkflowState, ImplementationPlan } from '../../../src/state/schemas.js';

const task = { taskId: 'actor-1', description: 'Add user registration endpoint', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...createInitialState(task), ...overrides };
}

describe('buildCompressedActorPrompt', () => {
  it('includes implementation plan when present', () => {
    const plan: ImplementationPlan = {
      planSummary: 'Add new UserService with create method',
      filesToCreate: ['src/services/UserService.ts'],
      filesToModify: ['src/app.ts'],
      filesToDelete: [],
      testFilesToCreate: ['tests/UserService.test.ts'],
      estimatedComplexity: 'medium',
      riskyAreas: ['database migration'],
      criticsApproved: true,
      fastCriticFindings: [],
    };

    const state = makeState({ implementationPlan: plan });
    const prompt = buildCompressedActorPrompt(state, 6);

    expect(prompt).toContain('## Implementation Plan');
    expect(prompt).toContain('Add new UserService with create method');
    expect(prompt).toContain('src/services/UserService.ts');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('tests/UserService.test.ts');
    expect(prompt).toContain('database migration');
  });

  it('includes session scratchpad when present', () => {
    const state = makeState({ sessionScratchpad: 'Remember: always use camelCase for local variables' });
    const prompt = buildCompressedActorPrompt(state, 6);

    expect(prompt).toContain('## Session Notes');
    expect(prompt).toContain('always use camelCase');
  });

  it('does not include plan section when no implementationPlan', () => {
    const state = makeState({ implementationPlan: null });
    const prompt = buildCompressedActorPrompt(state, 6);

    expect(prompt).not.toContain('## Implementation Plan');
  });

  it('does not include session notes when no scratchpad', () => {
    const state = makeState({ sessionScratchpad: null });
    const prompt = buildCompressedActorPrompt(state, 6);

    expect(prompt).not.toContain('## Session Notes');
  });

  it('includes plan warnings when critics not approved', () => {
    const plan: ImplementationPlan = {
      planSummary: 'Simple change',
      filesToCreate: [],
      filesToModify: ['src/main.ts'],
      filesToDelete: [],
      testFilesToCreate: [],
      estimatedComplexity: 'low',
      riskyAreas: [],
      criticsApproved: false,
      fastCriticFindings: [
        { critic: 'security', severity: 'warning', file: 'src/main.ts', line: 10, ruleId: 'sql-injection', message: 'Use parameterized queries', resolutionHint: 'Use prepared statements' },
      ],
    };

    const state = makeState({ implementationPlan: plan });
    const prompt = buildCompressedActorPrompt(state, 6);

    expect(prompt).toContain('## Implementation Plan');
    expect(prompt).toContain('Plan warnings');
    expect(prompt).toContain('Use parameterized queries');
  });
});
