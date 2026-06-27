import { describe, it, expect } from 'vitest';
import {
  isControllerFile, isTestFile, getDependencyFile,
  detectDeletedPublicMethods,
} from '../activities/critics/shared.js';
import type { ILanguagePlugin } from '@tacv/language-plugins-base';
import type { LanguageSyntaxInfo } from '@tacv/language-plugins-base';

// ── Minimal plugin stubs ──────────────────────────────────────────────────────
function makePlugin(info: Partial<LanguageSyntaxInfo>): Pick<ILanguagePlugin, 'getSyntaxInfo'> {
  const defaults: LanguageSyntaxInfo = {
    controllerFilePattern:  null,
    dependencyManifestFile: 'package.json',
    packageEcosystem:       'npm',
    testFilePattern:        /\.(test|spec)\.(ts|js)$/,
    publicMethodPattern:    /export\s+(?:async\s+)?function\s+(\w+)/gm,
    classPattern:           /class\s+(\w+)/gm,
    defaultApplicationPort: 3000,
  };
  return { getSyntaxInfo: () => ({ ...defaults, ...info }) };
}

describe('isControllerFile() — plugin-delegated', () => {
  it('returns true when file matches controllerFilePattern', () => {
    const plugin = makePlugin({ controllerFilePattern: /Controller\.(ts|java)$/ });
    expect(isControllerFile('UserController.ts', plugin)).toBe(true);
  });

  it('returns false when file does not match', () => {
    const plugin = makePlugin({ controllerFilePattern: /Controller\.(ts|java)$/ });
    expect(isControllerFile('UserService.ts', plugin)).toBe(false);
  });

  it('returns false when controllerFilePattern is null', () => {
    const plugin = makePlugin({ controllerFilePattern: null });
    expect(isControllerFile('anything.ts', plugin)).toBe(false);
  });

  it('works with Java controller pattern', () => {
    const plugin = makePlugin({ controllerFilePattern: /(Controller|Resource)\.java$/ });
    expect(isControllerFile('OrderResource.java', plugin)).toBe(true);
    expect(isControllerFile('OrderService.java', plugin)).toBe(false);
  });
});

describe('isTestFile() — plugin-delegated', () => {
  it('returns true for .test.ts files', () => {
    const plugin = makePlugin({ testFilePattern: /\.(test|spec)\.(ts|js)$/ });
    expect(isTestFile('UserService.test.ts', plugin)).toBe(true);
  });

  it('returns true for Java Test.java files', () => {
    const plugin = makePlugin({ testFilePattern: /(Test|IT)\.java$/ });
    expect(isTestFile('UserServiceTest.java', plugin)).toBe(true);
    expect(isTestFile('UserServiceIT.java', plugin)).toBe(true);
  });

  it('returns false for source files', () => {
    const plugin = makePlugin({ testFilePattern: /\.(test|spec)\.(ts|js)$/ });
    expect(isTestFile('UserService.ts', plugin)).toBe(false);
  });
});

describe('getDependencyFile() — plugin-delegated', () => {
  it('returns package.json for npm ecosystem', () => {
    const plugin = makePlugin({ dependencyManifestFile: 'package.json' });
    expect(getDependencyFile(plugin)).toBe('package.json');
  });

  it('returns pom.xml for maven', () => {
    const plugin = makePlugin({ dependencyManifestFile: 'pom.xml' });
    expect(getDependencyFile(plugin)).toBe('pom.xml');
  });

  it('returns Cargo.toml for rust', () => {
    const plugin = makePlugin({ dependencyManifestFile: 'Cargo.toml' });
    expect(getDependencyFile(plugin)).toBe('Cargo.toml');
  });
});

describe('detectDeletedPublicMethods() — plugin-delegated', () => {
  it('detects deleted TypeScript exported functions', () => {
    const plugin = makePlugin({
      publicMethodPattern: /export\s+(?:async\s+)?function\s+(\w+)/gm,
    });
    const diff = '- export function processPayment() {}\n+ // removed';
    expect(detectDeletedPublicMethods(diff, plugin)).toContain('processPayment');
  });

  it('detects deleted Java public methods', () => {
    const plugin = makePlugin({
      publicMethodPattern: /public\s+[\w<>\[\]]+\s+(\w+)\s*\(/gm,
    });
    const diff = '- public User findById(Long id) {\n+ // removed';
    expect(detectDeletedPublicMethods(diff, plugin)).toContain('findById');
  });

  it('ignores added lines', () => {
    const plugin = makePlugin({
      publicMethodPattern: /export\s+function\s+(\w+)/gm,
    });
    const diff = '+ export function newMethod() {}';
    expect(detectDeletedPublicMethods(diff, plugin)).toHaveLength(0);
  });

  it('returns empty array for diff with no public methods', () => {
    const plugin = makePlugin({
      publicMethodPattern: /export\s+function\s+(\w+)/gm,
    });
    const diff = '- const x = 42;\n- // just a comment';
    expect(detectDeletedPublicMethods(diff, plugin)).toHaveLength(0);
  });
});
