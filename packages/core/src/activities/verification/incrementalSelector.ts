import * as path from 'node:path';

export async function selectAffectedTests(
  changedFiles:  string[],
  allTestFiles:  string[],
  getBlastRadius?: (files: string[]) => Promise<{ affectedFiles: string[] }>,
): Promise<string[]> {
  const affectedFromBlast: Set<string> = new Set();

  if (getBlastRadius) {
    try {
      const blast = await getBlastRadius(changedFiles);
      blast.affectedFiles.forEach(f => affectedFromBlast.add(f));
    } catch { /* fallback to stem matching */ }
  }

  return allTestFiles.filter(testFile => {
    // Direct blast radius match
    if (affectedFromBlast.has(testFile)) return true;
    // Stem matching: UserService.ts → UserService.test.ts
    const stem = path.basename(testFile).replace(/\.(test|spec)\.(ts|tsx|js)$/, '').replace(/Test(\.java)?$/, '').replace(/IT(\.java)?$/, '');
    return changedFiles.some(c => {
      const cStem = path.basename(c, path.extname(c));
      return cStem === stem || cStem.includes(stem) || stem.includes(cStem);
    });
  });
}
