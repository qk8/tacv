import * as path from 'node:path';
import type { DiffProposal, AstDiffResult, SemanticChange } from '@tacv/core/state';
import type { LanguagePluginRegistry } from '@tacv/language-plugins-base';

type SymbolKind = 'function' | 'class' | 'method' | 'field';

interface ExtractedSymbol { name: string; kind: SymbolKind; isPublic: boolean; startLine: number }

const CONTROL_FLOW = new Set(['if','for','while','switch','catch','return','new','throw','try','else','do']);

/**
 * Analyzes diff proposals to produce semantic change reports.
 *
 * Accepts an optional `LanguagePluginRegistry`. When provided, symbol extraction
 * is fully delegated to `plugin.getSyntaxInfo().publicMethodPattern` and
 * `plugin.getSyntaxInfo().classPattern` — eliminating the hardcoded
 * `if (lang === 'java')` dispatch that previously lived here.
 *
 * When no registry is provided (or no plugin matches the file extension),
 * the analyzer falls back to the built-in heuristic patterns so existing
 * callers that don't yet inject a registry keep working.
 */
export class AstDiffAnalyzer {
  constructor(private readonly pluginRegistry?: LanguagePluginRegistry) {}

  async analyze(repoPath: string, proposal: DiffProposal): Promise<AstDiffResult> {
    const changes: SemanticChange[] = [];

    for (const diff of proposal.diffs) {
      const ext         = path.extname(diff.filePath);
      const fileChanges = this._analyzeTextDiff(diff.diffContent, diff.filePath, ext);
      changes.push(...fileChanges);
    }

    const breakingCount = changes.filter(c => c.breakingRisk === 'high' || c.breakingRisk === 'medium').length;
    return { semanticChanges: changes, breakingChangeCount: breakingCount, safeChangeCount: changes.length - breakingCount };
  }

  private _analyzeTextDiff(diffContent: string, filePath: string, ext: string): SemanticChange[] {
    const changes: SemanticChange[] = [];
    const lines          = diffContent.split('\n');
    const addedSymbols   = this._extractSymbolsFromLines(lines.filter(l => l.startsWith('+')), ext);
    const removedSymbols = this._extractSymbolsFromLines(lines.filter(l => l.startsWith('-')), ext);

    for (const sym of addedSymbols) {
      changes.push({ file: filePath, kind: sym.kind === 'class' ? 'class_added' : 'method_added', symbolName: sym.name, description: `${sym.kind} '${sym.name}' added`, breakingRisk: 'none' });
    }
    for (const sym of removedSymbols) {
      changes.push({ file: filePath, kind: sym.kind === 'class' ? 'class_removed' : 'method_removed', symbolName: sym.name, description: `${sym.kind} '${sym.name}' removed`, breakingRisk: sym.isPublic ? 'high' : 'low' });
    }
    return changes;
  }

  private _extractSymbolsFromLines(lines: string[], ext: string): ExtractedSymbol[] {
    const content = lines.map(l => l.slice(1)).join('\n');
    const plugin  = this.pluginRegistry?.getForExtension(ext) ?? null;

    if (plugin) {
      // ★ Plugin-delegated: use the plugin's own regex patterns
      return this._extractWithPlugin(content, plugin.getSyntaxInfo().publicMethodPattern, plugin.getSyntaxInfo().classPattern);
    }

    // ★ Fallback: built-in heuristics for unknown extensions
    return this._extractWithBuiltins(content, ext.slice(1));
  }

  private _extractWithPlugin(content: string, methodPattern: RegExp, classPattern: RegExp): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    // Reset lastIndex on cloned pattern to prevent stale state across calls
    const mp = new RegExp(methodPattern.source, 'gm');
    const cp = new RegExp(classPattern.source,  'gm');

    for (const m of content.matchAll(mp)) {
      const name = m[1] ?? m[2];
      if (name && !CONTROL_FLOW.has(name)) {
        symbols.push({ name, kind: 'method', isPublic: true, startLine: 0 });
      }
    }
    for (const m of content.matchAll(cp)) {
      if (m[1] && !CONTROL_FLOW.has(m[1])) {
        symbols.push({ name: m[1], kind: 'class', isPublic: true, startLine: 0 });
      }
    }
    return symbols;
  }

  private _extractWithBuiltins(content: string, lang: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    if (lang === 'java' || lang === 'kt') {
      for (const m of content.matchAll(/(public|protected|private|)\s+[\w<>[\]]+\s+(\w+)\s*\(/gm)) {
        if (!m[2] || CONTROL_FLOW.has(m[2])) continue;
        symbols.push({ name: m[2], kind: 'method', isPublic: m[1] === 'public', startLine: 0 });
      }
      for (const m of content.matchAll(/class\s+(\w+)/gm)) {
        if (m[1]) symbols.push({ name: m[1], kind: 'class', isPublic: true, startLine: 0 });
      }
    } else {
      // TypeScript / JavaScript default
      for (const m of content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)) if (m[1]) symbols.push({ name: m[1], kind: 'function', isPublic: true, startLine: 0 });
      for (const m of content.matchAll(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm)) if (m[1]) symbols.push({ name: m[1], kind: 'function', isPublic: true, startLine: 0 });
      // Class methods (public/private/protected/async qualifier before name)
      for (const m of content.matchAll(/(?:public|private|protected)\s+(?:async\s+)?(?:static\s+)?(\w+)\s*\(/gm)) {
        if (m[1] && !CONTROL_FLOW.has(m[1])) symbols.push({ name: m[1], kind: 'method', isPublic: true, startLine: 0 });
      }
      for (const m of content.matchAll(/class\s+(\w+)/gm)) if (m[1]) symbols.push({ name: m[1], kind: 'class', isPublic: true, startLine: 0 });
    }
    return symbols;
  }
}
