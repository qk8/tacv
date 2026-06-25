import { describe, it, expect } from 'vitest';
import { TypeScriptPlugin }  from '../src/TypeScriptPlugin.js';
import { ReactProfile }      from '../src/profiles/ReactProfile.js';

describe('TypeScriptPlugin', () => {
  const plugin = new TypeScriptPlugin();

  it('has correct metadata', () => {
    expect(plugin.metadata.languageId).toBe('typescript');
    expect(plugin.metadata.extensions).toContain('.ts');
    expect(plugin.metadata.extensions).toContain('.tsx');
  });

  it('detects deleted test cases', () => {
    const diff = `- it('should process payment', () => {\n-   expect(true).toBe(true);\n- });`;
    const deleted = plugin.detectDeletedTests(diff);
    expect(deleted).toContain('should process payment');
  });

  it('does not flag added test cases', () => {
    const diff = `+ it('should validate email', () => {\n+   expect(isEmail('a@b.com')).toBe(true);\n+ });`;
    const deleted = plugin.detectDeletedTests(diff);
    expect(deleted).toHaveLength(0);
  });

  it('generates vitest skeleton for plain TS file', async () => {
    const scaffold = await plugin.generateTestSkeleton('src/utils/format.ts', { primaryBehaviourDescription: 'formats a date correctly' });
    expect(scaffold.testFilePath).toContain('.test.ts');
    expect(scaffold.testContent).toContain('vitest');
  });

  it('routes React component to ReactProfile', () => {
    const profile = plugin.getProfileFor('src/components/Button.tsx');
    expect(profile?.profileId).toBe('react');
  });

  it('returns null for unknown file', () => {
    const profile = plugin.getProfileFor('src/models/User.ts');
    expect(profile).toBeNull();
  });
});

describe('ReactProfile', () => {
  const profile = new ReactProfile();

  it('matches tsx files in components dir', () => {
    expect(profile.matches('src/components/Button.tsx')).toBe(true);
  });

  it('does not match plain ts files', () => {
    expect(profile.matches('src/services/api.ts')).toBe(false);
  });

  it('generates test with component name', () => {
    const scaffold = profile.generateTestTemplate('src/components/Button.tsx', { primaryBehaviourDescription: 'renders a button' });
    expect(scaffold.testContent).toContain('Button');
    expect(scaffold.testContent).toContain('@testing-library/react');
    expect(scaffold.testFilePath).toBe('src/components/Button.test.tsx');
  });

  it('generates E2E test with viewports', () => {
    const e2e = profile.generateE2eTestTemplate!('Login Page', '/login');
    expect(e2e.testContent).toContain('VIEWPORTS');
    expect(e2e.testContent).toContain('/login');
  });
});
