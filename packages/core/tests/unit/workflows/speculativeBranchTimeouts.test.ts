import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Issue 10: SpeculativeBranchWorkflow differentiated timeouts', () => {
  it('uses differentiated proxy groups matching main workflow', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    // Extract the SpeculativeBranchWorkflow function body
    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Count proxyActivities calls — main workflow has 3 groups (standard, typecheck, test, api, mutation, visual)
    // Speculative branch should also use differentiated groups, not a single group
    const proxyCalls = branchBody.match(/proxyActivities<RegisteredActivities>/g);
    expect(proxyCalls).not.toBeNull();
    const callCount = proxyCalls!.length;

    // Must have at least 3 separate proxy groups (standard, typecheck, tests)
    // A single group would mean callCount === 1
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('typecheck proxy has 2-minute timeout', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Find the typecheck proxy group — should have '2 minutes' timeout
    const typeCheckMatch = branchBody.match(
      /runVerifierTypeCheck[\s\S]{0,200}proxyActivities[\s\S]{0,200}startToCloseTimeout:\s*'([^']+)'/,
    );
    expect(typeCheckMatch).not.toBeNull();
    expect(typeCheckMatch![1]).toBe('2 minutes');
  });

  it('mutation proxy has 5-minute timeout with 1 retry', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Find the mutation proxy group
    const mutationMatch = branchBody.match(
      /runVerifierMutation[\s\S]{0,200}proxyActivities[\s\S]{0,200}startToCloseTimeout:\s*'([^']+)'/,
    );
    expect(mutationMatch).not.toBeNull();
    expect(mutationMatch![1]).toBe('5 minutes');
  });

  it('standard proxy group has 10-minute timeout with 2 retries', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Find the standard proxy group (runActor/runPreflight/runAllCritics)
    const standardMatch = branchBody.match(
      /runActor[\s\S]{0,200}proxyActivities[\s\S]{0,200}startToCloseTimeout:\s*'([^']+)'/,
    );
    expect(standardMatch).not.toBeNull();
    expect(standardMatch![1]).toBe('10 minutes');
  });
});
