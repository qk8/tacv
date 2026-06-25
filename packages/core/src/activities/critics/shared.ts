import type { CriticFinding, WorkflowState, DiffProposal } from '../../state/schemas.js';
export type { CriticFinding };

export function isBackendModule(moduleType: string): boolean {
  return moduleType.includes('backend') || moduleType.includes('api') || moduleType.includes('service');
}
export function isFrontendModule(moduleType: string): boolean {
  return moduleType.includes('frontend') || moduleType.includes('ui') || moduleType.includes('react') || moduleType.includes('vue');
}
export function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) || filePath.includes('__tests__') || filePath.endsWith('Test.java') || filePath.endsWith('IT.java');
}
export function isControllerFile(filePath: string, languageId: string): boolean {
  if (languageId === 'java') return filePath.endsWith('Controller.java') || filePath.endsWith('Resource.java');
  return filePath.includes('/routes/') || filePath.includes('/controllers/') || filePath.includes('/api/');
}
export function isEntityFile(filePath: string): boolean {
  return filePath.endsWith('Entity.java') || filePath.endsWith('Model.java') || filePath.includes('/entities/');
}
export function getDependencyFile(languageId: string): string {
  return languageId === 'java' ? 'pom.xml' : 'package.json';
}
export function extractAddedDependencies(proposal: DiffProposal): Array<{ name: string; version: string; ecosystem: 'npm' | 'maven' }> {
  const added: Array<{ name: string; version: string; ecosystem: 'npm' | 'maven' }> = [];
  for (const diff of proposal.diffs) {
    if (diff.filePath === 'package.json') {
      const matches = diff.diffContent.matchAll(/^\+\s+"([^"]+)":\s+"([^"]+)"/gm);
      for (const m of matches) if (m[1] && m[2]) added.push({ name: m[1], version: m[2], ecosystem: 'npm' });
    }
    if (diff.filePath === 'pom.xml') {
      const matches = diff.diffContent.matchAll(/^\+\s*<artifactId>([^<]+)<\/artifactId>/gm);
      for (const m of matches) if (m[1]) added.push({ name: m[1], version: 'unknown', ecosystem: 'maven' });
    }
  }
  return added;
}
export function detectDeletedPublicMethods(diffContent: string, languageId: string): string[] {
  const removed: string[] = [];
  for (const line of diffContent.split('\n')) {
    if (!line.startsWith('-')) continue;
    if (languageId === 'java') {
      const m = line.match(/public\s+\w[\w<>[\]]*\s+(\w+)\s*\(/);
      if (m?.[1]) removed.push(m[1]);
    } else {
      const m = line.match(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/);
      if (m?.[1] ?? m?.[2]) removed.push((m[1] ?? m[2])!);
    }
  }
  return removed;
}
export function containsFieldRename(diffContent: string): boolean {
  const removed = diffContent.split('\n').filter(l => l.startsWith('-') && /private\s+\w+\s+(\w+)/.test(l));
  const added   = diffContent.split('\n').filter(l => l.startsWith('+') && /private\s+\w+\s+(\w+)/.test(l));
  return removed.length > 0 && added.length > 0;
}
