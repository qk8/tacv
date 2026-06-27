import type { CriticFinding, WorkflowState, DiffProposal } from '../../state/schemas.js';
import type { ILanguagePlugin, LanguageSyntaxInfo } from '@tacv/language-plugins-base';

export type { CriticFinding };

// ── Module type helpers (no language knowledge required) ──────────────────────

export function isBackendModule(moduleType: string): boolean {
  return moduleType.includes('backend') || moduleType.includes('api') || moduleType.includes('service');
}
export function isFrontendModule(moduleType: string): boolean {
  return moduleType.includes('frontend') || moduleType.includes('ui') || moduleType.includes('react') || moduleType.includes('vue');
}

// ── Plugin-delegated helpers (replace all `if (languageId === 'java')` switches)

type SyntaxInfoProvider = Pick<ILanguagePlugin, 'getSyntaxInfo'>;

/**
 * Returns true if the file matches the plugin's controller/route pattern.
 * Replaces: `if (languageId === 'java') return f.endsWith('Controller.java') ...`
 */
export function isControllerFile(filePath: string, plugin: SyntaxInfoProvider): boolean {
  const pattern = plugin.getSyntaxInfo().controllerFilePattern;
  return pattern ? pattern.test(filePath) : false;
}

/**
 * Returns true if the file matches the plugin's test file pattern.
 * Replaces the hardcoded `.test.ts` / `Test.java` suffix checks scattered across activities.
 */
export function isTestFile(filePath: string, plugin: SyntaxInfoProvider): boolean {
  return plugin.getSyntaxInfo().testFilePattern.test(filePath);
}

export function isEntityFile(filePath: string): boolean {
  return filePath.endsWith('Entity.java') || filePath.endsWith('Model.java') || filePath.includes('/entities/');
}

/**
 * Returns the dependency manifest filename for this language.
 * Replaces: `languageId === 'java' ? 'pom.xml' : 'package.json'`
 */
export function getDependencyFile(plugin: SyntaxInfoProvider): string {
  return plugin.getSyntaxInfo().dependencyManifestFile;
}

/**
 * Detects deleted public API symbols using the plugin's `publicMethodPattern`.
 * Replaces the Java/TS-specific regex blocks in the compatibility critic.
 */
export function detectDeletedPublicMethods(
  diffContent: string,
  plugin: SyntaxInfoProvider,
): string[] {
  const removed: string[] = [];
  // Reset lastIndex since we reuse the pattern across calls
  const pattern = new RegExp(plugin.getSyntaxInfo().publicMethodPattern.source, 'gm');
  for (const line of diffContent.split('\n')) {
    if (!line.startsWith('-')) continue;
    for (const m of line.matchAll(pattern)) {
      const name = m[1] ?? m[2];
      if (name) removed.push(name);
    }
  }
  return removed;
}

// ── Dependency extraction (remains manifest-name-aware, not language-hardcoded)

export function extractAddedDependencies(
  proposal: DiffProposal,
): Array<{ name: string; version: string; ecosystem: 'npm' | 'maven' | 'gradle' }> {
  const added: Array<{ name: string; version: string; ecosystem: 'npm' | 'maven' | 'gradle' }> = [];
  for (const diff of proposal.diffs) {
    if (diff.filePath === 'package.json') {
      const matches = diff.diffContent.matchAll(/^\+\s+"([^"]+)":\s+"([^"]+)"/gm);
      for (const m of matches) if (m[1] && m[2]) added.push({ name: m[1], version: m[2], ecosystem: 'npm' });
    }
    if (diff.filePath === 'pom.xml') {
      const matches = diff.diffContent.matchAll(/^\+\s*<artifactId>([^<]+)<\/artifactId>/gm);
      for (const m of matches) if (m[1]) added.push({ name: m[1], version: 'unknown', ecosystem: 'maven' });
    }
    if (diff.filePath === 'build.gradle' || diff.filePath === 'build.gradle.kts') {
      const matches = diff.diffContent.matchAll(/^\+\s+(?:implementation|api|compile)[^'"]+'([^']+)'/gm);
      for (const m of matches) if (m[1]) added.push({ name: m[1], version: 'unknown', ecosystem: 'gradle' });
    }
  }
  return added;
}

export function containsFieldRename(diffContent: string): boolean {
  const removed = diffContent.split('\n').filter(l => l.startsWith('-') && /private\s+\w+\s+(\w+)/.test(l));
  const added   = diffContent.split('\n').filter(l => l.startsWith('+') && /private\s+\w+\s+(\w+)/.test(l));
  return removed.length > 0 && added.length > 0;
}
