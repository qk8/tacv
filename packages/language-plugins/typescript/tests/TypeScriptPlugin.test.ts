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
    expect(plugin.detectDeletedTests(diff)).toHaveLength(0);
  });

  it('generates vitest skeleton for plain TS file', async () => {
    const scaffold = await plugin.generateTestSkeleton('src/utils/format.ts', { primaryBehaviourDescription: 'formats a date correctly' });
    expect(scaffold.testFilePath).toContain('.test.ts');
    expect(scaffold.testContent).toContain('vitest');
  });

  it('routes React component to ReactProfile', () => {
    expect(plugin.getProfileFor('src/components/Button.tsx')?.profileId).toBe('react');
  });

  it('returns null for non-framework file', () => {
    expect(plugin.getProfileFor('src/models/User.ts')).toBeNull();
  });

  // ── NEW: getSyntaxInfo ─────────────────────────────────────────────────────
  it('getSyntaxInfo returns correct controller pattern', () => {
    const info = plugin.getSyntaxInfo();
    expect(info.controllerFilePattern?.test('src/routes/users.ts')).toBe(true);
    expect(info.controllerFilePattern?.test('src/controllers/UserController.ts')).toBe(true);
    expect(info.controllerFilePattern?.test('src/models/User.ts')).toBe(false);
  });

  it('getSyntaxInfo: dependencyManifestFile is package.json', () => {
    expect(plugin.getSyntaxInfo().dependencyManifestFile).toBe('package.json');
  });

  it('getSyntaxInfo: packageEcosystem is npm', () => {
    expect(plugin.getSyntaxInfo().packageEcosystem).toBe('npm');
  });

  it('getSyntaxInfo: testFilePattern matches test files', () => {
    const pat = plugin.getSyntaxInfo().testFilePattern;
    expect(pat.test('UserService.test.ts')).toBe(true);
    expect(pat.test('Button.spec.tsx')).toBe(true);
    expect(pat.test('UserService.ts')).toBe(false);
  });

  it('getSyntaxInfo: publicMethodPattern captures exported function names', () => {
    const src = 'export function doWork() {}\nexport async function fetchUser() {}';
    const matches = [...src.matchAll(plugin.getSyntaxInfo().publicMethodPattern)].map(m => m[1]);
    expect(matches).toContain('doWork');
    expect(matches).toContain('fetchUser');
  });

  it('getSyntaxInfo: defaultApplicationPort is 3000', () => {
    expect(plugin.getSyntaxInfo().defaultApplicationPort).toBe(3000);
  });

  // ── NEW: getErrorPatterns ──────────────────────────────────────────────────
  it('getErrorPatterns classifies TypeError as NULL_REFERENCE', () => {
    const patterns = plugin.getErrorPatterns();
    const raw = "TypeError: Cannot read properties of undefined (reading 'id')";
    let matched = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(raw))) { matched = type; break; }
    }
    expect(matched).toBe('NULL_REFERENCE');
  });

  it('getErrorPatterns classifies React state update as REACT_STATE_MISMATCH', () => {
    const patterns = plugin.getErrorPatterns();
    const raw = "Warning: Can't perform a React state update on an unmounted component";
    let matched = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(raw))) { matched = type; break; }
    }
    expect(matched).toBe('REACT_STATE_MISMATCH');
  });

  it('getErrorPatterns classifies UnhandledPromiseRejection', () => {
    const patterns = plugin.getErrorPatterns();
    const raw = 'UnhandledPromiseRejectionWarning: Error: request timed out';
    let matched = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(raw))) { matched = type; break; }
    }
    expect(matched).toBe('ASYNC_PROMISE_UNHANDLED');
  });

  // ── NEW: createStackParser ─────────────────────────────────────────────────
  it('createStackParser returns a parser that strips node_modules frames', () => {
    const parser = plugin.createStackParser({ userRoot: 'src' });
    const raw = `TypeError: Cannot read properties of undefined\n    at UserService.findById (src/services/UserService.ts:45:18)\n    at /app/node_modules/express/lib/router/layer.js:95:5`;
    const frames = parser.parseAndPrune(raw, 'backend');
    expect(frames.some(f => f.file.includes('UserService'))).toBe(true);
    expect(frames.some(f => f.file.includes('node_modules'))).toBe(false);
  });

  it('createStackParser marks user-code frames as isUser=true', () => {
    const parser = plugin.createStackParser({ userRoot: 'src' });
    const raw = `    at UserService.findById (src/services/UserService.ts:45:18)`;
    const frames = parser.parseAndPrune(raw, 'backend');
    expect(frames.every(f => f.isUser)).toBe(true);
  });

  it('createStackParser returns empty for non-stack output', () => {
    const parser = plugin.createStackParser();
    expect(parser.parseAndPrune('Build failed: syntax error', 'backend')).toHaveLength(0);
  });

  // ── NEW: getDebugAdapterSpec ───────────────────────────────────────────────
  it('getDebugAdapterSpec returns cdp protocol', () => {
    const spec = plugin.getDebugAdapterSpec();
    expect(spec?.protocol).toBe('cdp');
  });

  it('getDebugAdapterSpec has port 9229', () => {
    expect(plugin.getDebugAdapterSpec()?.defaultPort).toBe(9229);
  });

  it('getDebugAdapterSpec launchCmdTemplate contains ${port}', () => {
    expect(plugin.getDebugAdapterSpec()?.launchCmdTemplate).toContain('${port}');
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
