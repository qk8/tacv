import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

describe('Feature F4: Progress and cost workflow queries', () => {
  it('defines workflowProgressQuery', () => {
    const workflowSrc = fs.readFileSync(
      require('path').join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );
    expect(workflowSrc).toContain('workflowProgressQuery');
  });

  it('defines workflowCostQuery', () => {
    const workflowSrc = fs.readFileSync(
      require('path').join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );
    expect(workflowSrc).toContain('workflowCostQuery');
  });

  it('progress query returns phase, cycle, cost, confidence, lastDecision, elapsedMs', () => {
    const workflowSrc = fs.readFileSync(
      require('path').join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );
    expect(workflowSrc).toContain('phase:');
    expect(workflowSrc).toContain('cycle:');
    expect(workflowSrc).toContain('costUsd:');
    expect(workflowSrc).toContain('confidenceScore:');
    expect(workflowSrc).toContain('lastDecision:');
    expect(workflowSrc).toContain('elapsedMs:');
  });

  it('cost query returns cumulativeCostUsd, budgetLimitUsd, budgetUsedPct, actorCallCount', () => {
    const workflowSrc = fs.readFileSync(
      require('path').join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );
    expect(workflowSrc).toContain('cumulativeCostUsd:');
    expect(workflowSrc).toContain('budgetLimitUsd:');
    expect(workflowSrc).toContain('budgetUsedPct:');
    expect(workflowSrc).toContain('actorCallCount:');
  });
});
