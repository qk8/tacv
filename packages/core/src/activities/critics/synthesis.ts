/**
 * Critic council synthesis.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * `getCriticDefs()` runs up to 11 critics in parallel and `allCriticsImpl`
 * concatenates their findings into one flat `criticFindings` array. When a
 * single design decision is bad along several dimensions at once — say, raw
 * SQL string concatenation in a repository class — the security critic, the
 * architecture critic, and the style critic each independently flag it. The
 * actor then receives N separate "issues" for what is actually one root
 * cause, and the compressed actor prompt (`buildCompressedActorPrompt`) only
 * shows the first 6 critical findings, so unrelated noise can crowd out a
 * genuinely separate critical issue.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `synthesizeFindings` groups findings that are spatially co-located (same
 * file — the cheapest, most defensible signal that two findings might share
 * a root cause) into a single `RootCauseGroup`, takes the highest severity
 * in the group, and deduplicates identical resolution guidance instead of
 * repeating it once per critic. `formatRootCausesForActor` renders the
 * synthesized groups as a compact, severity-ordered, capped list — this is
 * what `buildCompressedActorPrompt` should consume instead of raw
 * `criticFindings`.
 */

import type { CriticFinding } from '../../state/schemas.js';

export interface RootCauseGroup {
  readonly id: string;
  readonly title: string;
  readonly findings: CriticFinding[];
  readonly affectedFiles: string[];
  readonly maxSeverity: CriticFinding['severity'];
  readonly resolutionHint: string;
}

const SEVERITY_RANK: Record<CriticFinding['severity'], number> = { critical: 3, warning: 2, info: 1 };

function highestSeverity(findings: CriticFinding[]): CriticFinding['severity'] {
  return findings.reduce<CriticFinding['severity']>(
    (max, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    'info',
  );
}

function mergeResolutionHints(findings: CriticFinding[]): string {
  const distinct = [...new Set(findings.map(f => f.resolutionHint.trim()).filter(Boolean))];
  return distinct.join('; ');
}

export function synthesizeFindings(findings: CriticFinding[]): RootCauseGroup[] {
  if (findings.length === 0) return [];

  const byFile = new Map<string, CriticFinding[]>();
  for (const f of findings) {
    const bucket = byFile.get(f.file) ?? [];
    bucket.push(f);
    byFile.set(f.file, bucket);
  }

  const groups: RootCauseGroup[] = [...byFile.entries()].map(([file, fs], idx) => {
    const distinctCritics = [...new Set(fs.map(f => f.critic))];
    return {
      id: `root-cause-${idx}-${file}`,
      title: `${file}: ${fs.length} related finding${fs.length > 1 ? 's' : ''} (${distinctCritics.join(', ')})`,
      findings: fs,
      affectedFiles: [file],
      maxSeverity: highestSeverity(fs),
      resolutionHint: mergeResolutionHints(fs),
    };
  });

  return groups.sort((a, b) => SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity]);
}

/**
 * Renders synthesized root causes as compact actor-facing guidance, capped at
 * `maxGroups` and prioritized by severity so the single most urgent root
 * cause always survives the cap even if it sorts last alphabetically by file.
 */
export function formatRootCausesForActor(groups: RootCauseGroup[], maxGroups = 6): string {
  if (groups.length === 0) return '';
  const top = [...groups]
    .sort((a, b) => SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity])
    .slice(0, maxGroups);
  return top
    .map(g => `- [${g.maxSeverity}] ${g.affectedFiles.join(', ')}: ${g.findings.length} finding(s) — ${g.resolutionHint}`)
    .join('\n');
}
