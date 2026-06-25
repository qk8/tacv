import type { ICodeGraphProvider, CallGraph, BlastRadius } from '@tacv/core/interfaces';
import type { DiffProposal, AstDiffResult } from '@tacv/core/state';
import { InMemoryGraph }      from './graph/InMemoryGraph.js';
import { BlastRadiusAnalyzer } from './analyzers/BlastRadiusAnalyzer.js';
import { DependencyAnalyzer }  from './analyzers/DependencyAnalyzer.js';
import { AstDiffAnalyzer }     from './analyzers/AstDiffAnalyzer.js';

export class CodeGraphService implements ICodeGraphProvider {
  private readonly graph    = new InMemoryGraph();
  private readonly blastRA  = new BlastRadiusAnalyzer(this.graph);
  private readonly depA     = new DependencyAnalyzer(this.graph);
  private readonly astDiffA = new AstDiffAnalyzer();

  constructor(private readonly repoPath: string = '.') {}

  async getCallGraph(fileHints: string[]): Promise<CallGraph> {
    return {
      entryPoint: fileHints[0] ?? 'main',
      nodes:      fileHints,
      edges:      [],
    };
  }

  async getBlastRadius(changedFiles: string[]): Promise<BlastRadius> {
    return this.blastRA.analyze(changedFiles, this.repoPath);
  }

  async getDependencySubgraph(fileHints: string[]): Promise<unknown> {
    return this.depA.buildSubgraph(fileHints, this.repoPath);
  }

  async computeAstDiff(_repoPath: string, proposal: DiffProposal): Promise<AstDiffResult> {
    return this.astDiffA.analyze(this.repoPath, proposal);
  }

  async selectAffectedTests(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const affected = this.graph.findAffectedFiles(changedFiles);
    const direct   = allTestFiles.filter(t => {
      const base = t.replace(/\.test\.(ts|tsx|js)$/, '')
                    .replace(/Test\.java$/, '')
                    .replace(/IT\.java$/, '')
                    .split('/').pop() ?? '';
      return changedFiles.some(cf => {
        const cfBase = cf.split('/').pop()?.replace(/\.(ts|tsx|java|js)$/, '') ?? '';
        return cfBase === base || cfBase === base.replace('Test', '');
      });
    });
    const combined = new Set([...affected, ...direct].filter(f => allTestFiles.includes(f)));
    return combined.size > 0 ? [...combined] : allTestFiles;
  }

  getGraph(): InMemoryGraph { return this.graph; }
}
