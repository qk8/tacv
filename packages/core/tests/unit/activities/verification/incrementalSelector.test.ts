import { describe, it, expect } from 'vitest';
import { selectAffectedTests } from '../../../../src/activities/verification/incrementalSelector.js';

const allTests = [
  'src/UserService.test.ts', 'src/OrderService.test.ts',
  'src/PaymentService.test.ts', 'src/EmailUtil.test.ts',
];

describe('selectAffectedTests', () => {
  it('selects tests matching changed file stem', async () => {
    const selected = await selectAffectedTests(['src/UserService.ts'], allTests);
    expect(selected).toContain('src/UserService.test.ts');
    expect(selected).not.toContain('src/OrderService.test.ts');
  });

  it('returns empty when no files match', async () => {
    const selected = await selectAffectedTests(['src/config.ts'], allTests);
    expect(selected).toHaveLength(0);
  });

  it('uses blast radius when provider supplied', async () => {
    const getBlastRadius = async () => ({ affectedFiles: ['src/OrderService.test.ts'] });
    const selected = await selectAffectedTests(['src/database.ts'], allTests, getBlastRadius);
    expect(selected).toContain('src/OrderService.test.ts');
  });

  it('selects multiple matching tests', async () => {
    const selected = await selectAffectedTests(['src/UserService.ts', 'src/OrderService.ts'], allTests);
    expect(selected).toContain('src/UserService.test.ts');
    expect(selected).toContain('src/OrderService.test.ts');
  });

  it('handles empty allTestFiles', async () => {
    const selected = await selectAffectedTests(['src/Foo.ts'], []);
    expect(selected).toHaveLength(0);
  });

  it('handles blast radius provider throwing', async () => {
    const getBlastRadius = async () => { throw new Error('graph unavailable'); };
    const selected = await selectAffectedTests(['src/UserService.ts'], allTests, getBlastRadius);
    expect(selected).toContain('src/UserService.test.ts');
  });
});
