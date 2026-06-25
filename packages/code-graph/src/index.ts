import type { ICodeGraphProvider, CallGraph, BlastRadius } from '@tacv/core/interfaces';
import type { AstDiffResult, DiffProposal } from '@tacv/core/state';
import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { InMemoryGraph }     from './graph/InMemoryGraph.js';
import { BlastRadiusAnalyzer } from './analyzers/BlastRadiusAnalyzer.js';
import { DependencyAnalyzer }  from './analyzers/DependencyAnalyzer.js';
import { AstDiffAnalyzer }     from './analyzers/AstDiffAnalyzer.js';

export { InMemoryGraph }      from './graph/InMemoryGraph.js';
export { BlastRadiusAnalyzer } from './analyzers/BlastRadiusAnalyzer.js';
export { DependencyAnalyzer }  from './analyzers/DependencyAnalyzer.js';
export { AstDiffAnalyzer }     from './analyzers/AstDiffAnalyzer.js';

export class CodeGraphService implements ICodeGraphProvider {
  private readonly graph = new InMemoryGraph();
  private readonly blastAnalyzer = new BlastRadiusAnalyzer(this.graph);
  private readonly depAnalyzer   = new DependencyAnalyzer(this.graph);
  private readonly astAnalyzer   = new AstDiffAnalyzer();

  async getCallGraph(fileHints: string[]): Promise<CallGraph> {
    const nodes = fileHints.length > 0 ? fileHints : await this._discover();
    const edges: Array<{ from: string; to: string }> = [];
    for (const file of nodes) {
      const content = await this._readFile(file);
      if (!content) continue;
      for (const imp of this._extractImports(content)) {
        const resolved = this._resolve(file, imp);
        if (resolved) {
          edges.push({ from: file, to: resolved });
          this.graph.addNode(file, 'file');
          this.graph.addNode(resolved, 'file');
          this.graph.addEdge(file, resolved);
        }
      }
    }
    return { entryPoint: fileHints[0] ?? nodes[0] ?? '', nodes, edges };
  }

  async getDependencySubgraph(fileHints: string[]): Promise<unknown> {
    await this.getCallGraph(fileHints);
    return this.depAnalyzer.buildSubgraph(fileHints, '.');
  }

  async getBlastRadius(changedFiles: string[]): Promise<BlastRadius> {
    // Build graph lazily for changed files
    for (const f of changedFiles) {
      const content = await this._readFile(f);
      if (!content) continue;
      this.graph.addNode(f, 'file');
      for (const imp of this._extractImports(content)) {
        const resolved = this._resolve(f, imp);
        if (resolved) { this.graph.addNode(resolved, 'file'); this.graph.addEdge(f, resolved); }
      }
    }
    return this.blastAnalyzer.analyze(changedFiles, '.');
  }

  async mapCodeToSchema(_entities: string[]): Promise<unknown> { return {}; }
  async getArchAlignment(_files: string[]): Promise<unknown>   { return { aligned: true }; }

  async computeAstDiff(repoPath: string, proposal: DiffProposal): Promise<AstDiffResult> {
    return this.astAnalyzer.analyze(repoPath, proposal);
  }

  async selectAffectedTests(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const blast = await this.getBlastRadius(changedFiles);
    const affected = new Set(blast.affectedFiles);
    return allTestFiles.filter(t => {
      if (affected.has(t)) return true;
      const stem = path.basename(t).replace(/\.(test|spec)\.(ts|tsx|js)$/, '').replace(/Test(\.java)?$/, '').replace(/IT(\.java)?$/, '');
      return changedFiles.some(c => { const cs = path.basename(c, path.extname(c)); return cs === stem || cs.includes(stem) || stem.includes(cs); });
    });
  }

  private async _readFile(filePath: string): Promise<string | null> {
    try { return await fs.readFile(filePath, 'utf8'); } catch { return null; }
  }
  private _extractImports(content: string): string[] {
    const imports: string[] = [];
    for (const line of content.split('\n')) {
      const m = line.match(/(?:import|require)[^'"]*['"]([^'"]+)['"]/);
      if (m?.[1]?.startsWith('.')) imports.push(m[1]);
    }
    return imports;
  }
  private _resolve(from: string, imp: string): string | null {
    const full = path.join(path.dirname(from), imp);
    return full.endsWith('.ts') || full.endsWith('.js') ? full : full + '.ts';
  }
  private async _discover(): Promise<string[]> {
    try { const { glob } = await import('glob'); return await glob(['src/**/*.ts','src/**/*.java'], { ignore: ['**/*.test.*','**/*.spec.*','**/node_modules/**'] }); } catch { return []; }
  }
}
