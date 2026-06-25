import type { WorkflowState, VisualTestResult } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';

export async function runVisualTests(_state: WorkflowState, _deps: ActivityDeps): Promise<VisualTestResult> {
  // Placeholder — full implementation in @tacv/visual-testing package
  return { passed: true, totalScreenshots: 0, failedScreenshots: 0, diffs: [], baselineUpdated: true };
}
