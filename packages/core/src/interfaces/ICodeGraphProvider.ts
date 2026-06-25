import type { AstDiffResult, DiffProposal } from '../state/index.js';

export interface CallGraph {
  entryPoint: string;
  nodes:      string[];
  edges:      Array<{ from: string; to: string }>;
}

export interface BlastRadius {
  entryFiles:         string[];
  affectedFiles:      string[];
  dependencyDepth:    number;
  crossServiceImpact: string[];
  schemaImpact:       string[];
  riskScore:          number;
}

export interface ICodeGraphProvider {
  getCallGraph(fileHints: string[]): Promise<CallGraph>;
  getDependencySubgraph(fileHints: string[]): Promise<unknown>;
  getBlastRadius(files: string[]): Promise<BlastRadius>;
  mapCodeToSchema(entities: string[]): Promise<unknown>;
  getArchAlignment(files: string[]): Promise<unknown>;
  computeAstDiff(repoPath: string, diffProposal: DiffProposal): Promise<AstDiffResult>;
  selectAffectedTests(changedFiles: string[], allTestFiles: string[]): Promise<string[]>;
}
