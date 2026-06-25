import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { extractAddedDependencies, getDependencyFile } from './shared.js';

export async function dependencyCritic(state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  const added = extractAddedDependencies(state.diffProposal);
  if (added.length === 0) return [];
  const langId = state.task.languageIds[0] ?? 'typescript';
  const findings: CriticFinding[] = [];
  for (const dep of added) {
    try {
      const res = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: { name: dep.name, ecosystem: dep.ecosystem === 'npm' ? 'npm' : 'Maven' }, version: dep.version }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json() as { vulns?: Array<{ id: string; summary: string; database_specific?: { severity?: string }; affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }> }> };
      if (data.vulns && data.vulns.length > 0) {
        for (const vuln of data.vulns.slice(0, 3)) {
          const severity = (vuln.database_specific?.severity ?? 'MEDIUM').toUpperCase();
          const fixed = vuln.affected?.[0]?.ranges?.[0]?.events?.find(e => e.fixed)?.fixed;
          findings.push({ critic: 'dependency_vuln', severity: severity === 'CRITICAL' ? 'critical' : 'warning', file: getDependencyFile(langId), line: null, ruleId: `OSV-${vuln.id}`, message: `${dep.name}@${dep.version}: ${vuln.summary}`, resolutionHint: fixed ? `Upgrade to ${fixed}` : 'No fixed version available — consider an alternative.' });
        }
      }
    } catch { /* OSV unavailable — skip silently */ }
  }
  return findings;
}

// Re-export for testing
export { extractAddedDependencies } from './shared.js';
