import { describe, it, expect } from 'vitest';
import { isTestFile as oldIsTestFile } from '../../../src/activities/critics/testPreservationCritic.js';
import { isTestFile as sharedIsTestFile } from '../../../src/activities/critics/shared.js';
import { stubPlugin } from '../../helpers/stubDeps.js';

describe('isTestFile — shared vs old (language-unaware)', () => {
  it('shared isTestFile uses plugin pattern', () => {
    // The old isTestFile only handles JS/TS and Java
    // Shared isTestFile delegates to plugin.getSyntaxInfo().testFilePattern
    const plugin = stubPlugin;
    const syntaxInfo = plugin.getSyntaxInfo();

    // TypeScript test patterns from the stub
    expect(syntaxInfo.testFilePattern.test('src/UserService.test.ts')).toBe(true);
    expect(syntaxInfo.testFilePattern.test('src/UserService.spec.ts')).toBe(true);
    expect(syntaxInfo.testFilePattern.test('src/UserService.test.js')).toBe(true);

    // Java test patterns from the stub
    expect(syntaxInfo.testFilePattern.test('src/UserServiceTest.java')).toBe(false); // stub uses TS patterns
    expect(syntaxInfo.testFilePattern.test('src/UserServiceIT.java')).toBe(false);   // stub uses TS patterns

    // Old hardcoded version handles Java
    expect(oldIsTestFile('src/UserServiceTest.java')).toBe(true);
    expect(oldIsTestFile('src/UserServiceIT.java')).toBe(true);

    // But old version does NOT handle Kotlin
    expect(oldIsTestFile('src/UserServiceTest.kt')).toBe(false);

    // Stub plugin for TypeScript does NOT handle Kotlin either
    // But a Java plugin would
    const javaPlugin = stubPlugin as never;
    const javaSyntax = { ...stubPlugin, getSyntaxInfo: () => ({
      ...stubPlugin.getSyntaxInfo(),
      testFilePattern: /(\.Test|\.Tests|\.Spec)\.(java|kt|scala)$|_test\.(java|kt|scala)$|test_.*\.(py|rb)$|_test\.(go)$|_tests\.(rs)$|Test.*\.(kt|scala)$/,
    }) };
    expect(sharedIsTestFile('src/UserServiceTest.kt', javaSyntax as never)).toBe(true);
    expect(sharedIsTestFile('src/handler_test.go', javaSyntax as never)).toBe(true);
    expect(sharedIsTestFile('src/test_user.py', javaSyntax as never)).toBe(true);
  });

  it('old isTestFile misses non-JS/Java test files', () => {
    // These should be recognized as test files but aren't by the old version
    expect(oldIsTestFile('src/UserServiceTest.kt')).toBe(false);    // Kotlin
    expect(oldIsTestFile('src/handler_test.go')).toBe(false);        // Go
    expect(oldIsTestFile('src/test_user.py')).toBe(false);           // Python
    expect(oldIsTestFile('src/user_tests.rs')).toBe(false);          // Rust
  });
});
