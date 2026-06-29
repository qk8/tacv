import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Issue 11: SpeculativeBranchWorkflow checkpoint + flakiness', () => {
  it('includes runGitCheckpoint activity', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Should define runGitCheckpoint proxy activity
    expect(branchBody).toContain('runGitCheckpoint');
  });

  it('includes runFlakinessCheck activity', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Should define runFlakinessCheck proxy activity
    expect(branchBody).toContain('runFlakinessCheck');
  });

  it('creates git checkpoint on verifier PASS', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Should call runGitCheckpoint before returning success
    expect(branchBody).toContain('runGitCheckpoint(s)');
  });

  it('checks flakiness on verifier FAIL with failures', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    const branchStart = workflowSrc.indexOf('export async function SpeculativeBranchWorkflow');
    const nextFnStart = workflowSrc.indexOf('export async function ShadowModeWorkflow', branchStart);
    const branchBody = workflowSrc.slice(branchStart, nextFnStart);

    // Should call runFlakinessCheck when verifier fails
    expect(branchBody).toContain('runFlakinessCheck(s)');
  });

  it('extends SpeculativeBranchResult with hadFlakiness field', () => {
    const workflowSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/workflows/CodingWorkflow.ts'),
      'utf8',
    );

    // SpeculativeBranchResult interface should have hadFlakiness field
    expect(workflowSrc).toContain('hadFlakiness');
  });
});
