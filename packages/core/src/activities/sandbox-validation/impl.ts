import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.sandbox_validation');

export async function sandboxValidationImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('sandbox_validation.start');

  const expected = deps.config.sandboxEnvExpected;
  if (!expected) return { ...state, sandboxEnvOk: true, currentPhase: 'ACTOR' };

  let handle: import('../../interfaces/ISandboxProvider.js').SandboxHandle | null = null;
  try {
    handle = await deps.sandbox.warmContainer();

    const probe = await deps.sandbox.execInContainer(handle, [
      'java -version 2>&1 | head -1 || echo "no-java"',
      'node --version 2>/dev/null || echo "no-node"',
      'mvn --version 2>&1 | head -1 || echo "no-maven"',
      'echo "TZ=${TZ:-UTC}"',
      'date +%Z',
    ].join(' && '), { timeoutMs: 10_000 });

    const output = probe.stdout + probe.stderr;
    const issues: string[] = [];

    if (expected.javaVersion) {
      const javaMatch = output.match(/version "(\d+)/);
      const actualJava = javaMatch?.[1];
      if (actualJava && actualJava !== expected.javaVersion) {
        issues.push(`Java version mismatch: expected ${expected.javaVersion}, got ${actualJava}`);
      }
    }

    if (expected.nodeVersion) {
      const nodeMatch = output.match(/v(\d+)\.\d+\.\d+/);
      const actualNode = nodeMatch?.[1];
      if (actualNode && actualNode !== expected.nodeVersion) {
        issues.push(`Node.js version mismatch: expected ${expected.nodeVersion}, got v${actualNode}`);
      }
    }

    if (expected.timezone) {
      const tzMatch = output.match(/TZ=(\S+)/);
      const actualTz = tzMatch?.[1];
      if (actualTz && actualTz !== expected.timezone) {
        issues.push(`Timezone mismatch: expected ${expected.timezone}, got ${actualTz}`);
      }
    }

    if (issues.length > 0) {
      log.warn('sandbox_validation.env_drift', { issues });
      // Log prominently but continue — drift is a warning, not a blocker
      return {
        ...state, sandboxEnvOk: false, currentPhase: 'ACTOR',
        workflowAuditTrail: [...state.workflowAuditTrail, {
          timestampMs: Date.now(), node: 'sandbox_validation',
          decision: 'env_drift_detected',
          keyValues: { issues, hint: 'Results in sandbox may differ from production.' },
        }],
      };
    }

    log.info('sandbox_validation.ok');
    return { ...state, sandboxEnvOk: true, currentPhase: 'ACTOR' };
  } catch (err) {
    log.warn('sandbox_validation.failed', { error: String(err) });
    return { ...state, sandboxEnvOk: null, currentPhase: 'ACTOR' };
  } finally {
    if (handle) await deps.sandbox.destroyContainer(handle).catch(() => {});
  }
}
