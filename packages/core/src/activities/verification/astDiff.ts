import type { DiffProposal, AstDiffResult, SemanticChange } from '../../state/schemas.js';
import type { ICodeGraphProvider } from '../../interfaces/ICodeGraphProvider.js';

export async function computeAstDiff(
  repoPath:  string,
  proposal:  DiffProposal,
  codeGraph: ICodeGraphProvider,
): Promise<AstDiffResult> {
  try {
    return await codeGraph.computeAstDiff(repoPath, proposal);
  } catch {
    // Fallback: simple heuristic-based analysis
    return heuristicAstDiff(proposal);
  }
}

function heuristicAstDiff(proposal: DiffProposal): AstDiffResult {
  const changes: SemanticChange[] = [];

  for (const diff of proposal.diffs) {
    const lines = diff.diffContent.split('\n');

    for (const line of lines) {
      if (line.startsWith('-')) {
        const methodMatch = line.match(/public\s+\w[\w<>[\],\s]+\s+(\w+)\s*\(|export\s+(?:function|const)\s+(\w+)/);
        const name = methodMatch?.[1] ?? methodMatch?.[2];
        if (name) {
          changes.push({
            file:         diff.filePath,
            kind:         'method_removed',
            symbolName:   name,
            description:  `${name} was removed`,
            breakingRisk: line.includes('public') || line.includes('export') ? 'high' : 'low',
          });
        }
      }
      if (line.startsWith('+')) {
        const methodMatch = line.match(/public\s+\w[\w<>[\],\s]+\s+(\w+)\s*\(|export\s+(?:function|const)\s+(\w+)/);
        const name = methodMatch?.[1] ?? methodMatch?.[2];
        if (name) {
          changes.push({
            file:         diff.filePath,
            kind:         'method_added',
            symbolName:   name,
            description:  `${name} was added`,
            breakingRisk: 'none',
          });
        }
      }
    }
  }

  const breakingCount = changes.filter(c => c.breakingRisk === 'high' || c.breakingRisk === 'medium').length;

  return {
    semanticChanges:     changes,
    breakingChangeCount: breakingCount,
    safeChangeCount:     changes.length - breakingCount,
  };
}
