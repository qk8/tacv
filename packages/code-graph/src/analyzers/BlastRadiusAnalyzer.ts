import type { BlastRadius } from '@tacv/core/interfaces';
import type { InMemoryGraph } from '../graph/InMemoryGraph.js';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.blast_radius');

export class BlastRadiusAnalyzer {
  constructor(private readonly graph: InMemoryGraph) {}

  async analyze(changedFiles: string[], repoPath: string): Promise<BlastRadius> {
    const affected = new Set<string>(changedFiles);
    const schemaImpact: string[] = [];
    const crossServiceImpact: string[] = [];

    // BFS from each changed file through the dependency graph
    for (const file of changedFiles) {
      const reachable = this.graph.getReachable(file, 6);
      for (const r of reachable) affected.add(r);

      // Detect schema impact: entity/model changes
      if (this._isEntityFile(file)) schemaImpact.push(file);

      // Detect cross-service impact: files that look like external API clients
      const importers = this.graph.getImportersOf(file);
      for (const importer of importers) {
        if (this._isCrossServiceFile(importer)) crossServiceImpact.push(importer);
      }
    }

    const riskScore = this._computeRiskScore(changedFiles, affected, schemaImpact, crossServiceImpact);
    log.info('blast_radius.analyzed', { changed: changedFiles.length, affected: affected.size, riskScore });

    return {
      entryFiles:         changedFiles,
      affectedFiles:      [...affected],
      dependencyDepth:    this._maxDepth(changedFiles),
      crossServiceImpact: [...new Set(crossServiceImpact)],
      schemaImpact:       [...new Set(schemaImpact)],
      riskScore,
    };
  }

  private _isEntityFile(file: string): boolean {
    return /Entity\.java$|Model\.java$|Schema\.ts$|\.prisma$/.test(file);
  }

  private _isCrossServiceFile(file: string): boolean {
    return /client|gateway|proxy|adapter/i.test(file) && !file.includes('test');
  }

  private _maxDepth(changedFiles: string[]): number {
    let max = 0;
    for (const f of changedFiles) {
      const reachable = this.graph.getReachable(f, 10);
      if (reachable.size > max) max = reachable.size;
    }
    return Math.min(max, 10);
  }

  private _computeRiskScore(
    changed: string[], affected: Set<string>,
    schemaImpact: string[], crossService: string[],
  ): number {
    let score = 0;
    const ratio = affected.size / Math.max(1, this.graph.nodeCount);
    score += Math.min(5, ratio * 20);       // up to 5 for blast spread
    score += Math.min(2, changed.length);    // up to 2 for number of changed files
    score += schemaImpact.length > 0 ? 2 : 0; // schema changes are risky
    score += crossService.length > 0 ? 1 : 0;  // cross-service changes
    return Math.min(10, Math.round(score));
  }
}
