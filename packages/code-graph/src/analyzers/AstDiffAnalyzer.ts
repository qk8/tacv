import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import type { DiffProposal, AstDiffResult, SemanticChange } from '@tacv/core/state';

type SymbolKind = 'function' | 'class' | 'method' | 'field';

interface ExtractedSymbol {
  name:     string;
  kind:     SymbolKind;
  isPublic: boolean;
  startLine: number;
}

export class AstDiffAnalyzer {
  async analyze(repoPath: string, proposal: DiffProposal): Promise<AstDiffResult> {
    const changes: SemanticChange[] = [];

    for (const diff of proposal.diffs) {
      const langExt = path.extname(diff.filePath).slice(1);
      const fileChanges = this._analyzeTextDiff(diff.diffContent, diff.filePath, langExt);
      changes.push(...fileChanges);
    }

    const breakingCount = changes.filter(c => c.breakingRisk === 'high' || c.breakingRisk === 'medium').length;
    return { semanticChanges: changes, breakingChangeCount: breakingCount, safeChangeCount: changes.length - breakingCount };
  }

  private _analyzeTextDiff(diffContent: string, filePath: string, lang: string): SemanticChange[] {
    const changes: SemanticChange[] = [];
    const lines = diffContent.split('\n');

    const addedSymbols   = this._extractSymbolsFromLines(lines.filter(l => l.startsWith('+')), lang);
    const removedSymbols = this._extractSymbolsFromLines(lines.filter(l => l.startsWith('-')), lang);

    for (const sym of addedSymbols) {
      changes.push({ file: filePath, kind: sym.kind === 'class' ? 'class_added' : 'method_added', symbolName: sym.name, description: `${sym.kind} '${sym.name}' added`, breakingRisk: 'none' });
    }

    for (const sym of removedSymbols) {
      const wasPublic = sym.isPublic;
      changes.push({ file: filePath, kind: sym.kind === 'class' ? 'class_removed' : 'method_removed', symbolName: sym.name, description: `${sym.kind} '${sym.name}' removed`, breakingRisk: wasPublic ? 'high' : 'low' });
    }

    return changes;
  }

  private _extractSymbolsFromLines(lines: string[], lang: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const content = lines.map(l => l.slice(1)).join('\n');

    if (lang === 'java') {
      const methodRe = /(public|protected|private|)\s+[\w<>[\]]+\s+(\w+)\s*\(/gm;
      const classRe  = /class\s+(\w+)/gm;
      for (const m of content.matchAll(methodRe)) {
        if (!m[2] || ['if','for','while','switch','catch'].includes(m[2])) continue;
        symbols.push({ name: m[2], kind: 'method', isPublic: m[1] === 'public', startLine: 0 });
      }
      for (const m of content.matchAll(classRe)) {
        if (m[1]) symbols.push({ name: m[1], kind: 'class', isPublic: true, startLine: 0 });
      }
    } else {
      // TypeScript/JavaScript
      const fnRe      = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
      const arrowRe   = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm;
      const methodRe  = /(?:public|private|protected|async)?\s*(\w+)\s*\(/gm;
      const classRe   = /class\s+(\w+)/gm;

      for (const m of content.matchAll(fnRe))    if (m[1]) symbols.push({ name: m[1], kind: 'function', isPublic: content.includes(`export`) , startLine: 0 });
      for (const m of content.matchAll(arrowRe)) if (m[1]) symbols.push({ name: m[1], kind: 'function', isPublic: content.includes(`export`), startLine: 0 });
      for (const m of content.matchAll(classRe)) if (m[1]) symbols.push({ name: m[1], kind: 'class', isPublic: true, startLine: 0 });
    }

    return symbols;
  }
}
