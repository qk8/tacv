import { describe, it, expect } from 'vitest';
import { JavaPlugin }        from '../src/JavaPlugin.js';
import { SpringBootProfile } from '../src/profiles/SpringBootProfile.js';

describe('JavaPlugin', () => {
  const plugin = new JavaPlugin();

  it('has correct metadata', () => {
    expect(plugin.metadata.languageId).toBe('java');
    expect(plugin.metadata.extensions).toContain('.java');
  });

  it('detects deleted @Test methods', () => {
    const diff = '- @Test\n- void should_return_user() {';
    expect(plugin.detectDeletedTests(diff)).toContain('should_return_user');
  });

  it('does not flag added tests', () => {
    const diff = '+ @Test\n+ void should_create_user() {';
    expect(plugin.detectDeletedTests(diff)).toHaveLength(0);
  });

  it('generates JUnit 5 skeleton', async () => {
    const scaffold = await plugin.generateTestSkeleton(
      'src/main/java/com/example/UserService.java',
      { primaryBehaviourDescription: 'creates a user' },
    );
    expect(scaffold.testContent).toContain('@Test');
    expect(scaffold.testFilePath).toContain('Test.java');
  });

  it('routes SpringBoot controllers to SpringBootProfile', () => {
    expect(
      plugin.getProfileFor('src/main/java/com/example/UserController.java')?.profileId,
    ).toBe('spring-boot');
  });

  // ── NEW: getSyntaxInfo ─────────────────────────────────────────────────────
  it('getSyntaxInfo: controllerFilePattern matches Controller.java files', () => {
    const pat = plugin.getSyntaxInfo().controllerFilePattern!;
    expect(pat.test('UserController.java')).toBe(true);
    expect(pat.test('OrderResource.java')).toBe(true);
    expect(pat.test('UserService.java')).toBe(false);
    expect(pat.test('UserDto.java')).toBe(false);
  });

  it('getSyntaxInfo: dependencyManifestFile defaults to pom.xml', () => {
    expect(plugin.getSyntaxInfo().dependencyManifestFile).toBe('pom.xml');
  });

  it('getSyntaxInfo: packageEcosystem is maven', () => {
    expect(plugin.getSyntaxInfo().packageEcosystem).toBe('maven');
  });

  it('getSyntaxInfo: testFilePattern matches Test.java and IT.java', () => {
    const pat = plugin.getSyntaxInfo().testFilePattern;
    expect(pat.test('UserServiceTest.java')).toBe(true);
    expect(pat.test('UserServiceIT.java')).toBe(true);
    expect(pat.test('UserService.java')).toBe(false);
  });

  it('getSyntaxInfo: publicMethodPattern captures public method names', () => {
    const src = 'public User findById(Long id) {}\npublic List<User> findAll() {}';
    const matches = [...src.matchAll(plugin.getSyntaxInfo().publicMethodPattern)].map(m => m[1]);
    expect(matches).toContain('findById');
    expect(matches).toContain('findAll');
  });

  it('getSyntaxInfo: defaultApplicationPort is 8080', () => {
    expect(plugin.getSyntaxInfo().defaultApplicationPort).toBe(8080);
  });

  // ── NEW: getErrorPatterns ──────────────────────────────────────────────────
  it('getErrorPatterns classifies NullPointerException as NULL_REFERENCE', () => {
    const patterns = plugin.getErrorPatterns();
    const raw = 'java.lang.NullPointerException: Cannot invoke method on null';
    let matched = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(raw))) { matched = type; break; }
    }
    expect(matched).toBe('NULL_REFERENCE');
  });

  it('getErrorPatterns classifies BeanCreationException', () => {
    const patterns = plugin.getErrorPatterns();
    const raw = 'BeanCreationException: Error creating bean with name userService';
    let matched = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(raw))) { matched = type; break; }
    }
    expect(matched).toBe('BEAN_CREATION_ERROR');
  });

  it('getErrorPatterns classifies ConstraintViolationException as VALIDATION_ERROR', () => {
    const patterns = plugin.getErrorPatterns();
    const raw = 'ConstraintViolationException: Validation failed for classes [com.example.User]';
    let matched = 'UNKNOWN';
    for (const [regexes, type] of patterns) {
      if (regexes.some(r => r.test(raw))) { matched = type; break; }
    }
    expect(matched).toBe('VALIDATION_ERROR');
  });

  // ── NEW: createStackParser ─────────────────────────────────────────────────
  it('createStackParser strips Spring framework frames', () => {
    const parser = plugin.createStackParser({ userPackagePrefix: 'com.example' });
    const raw = `java.lang.NullPointerException
  at com.example.service.UserService.findById(UserService.java:45)
  at com.example.controller.UserController.getUser(UserController.java:23)
  at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:897)
  at javax.servlet.http.HttpServlet.service(HttpServlet.java:764)`;
    const frames = parser.parseAndPrune(raw, 'backend');
    expect(frames.every(f => f.isUser)).toBe(true);
    expect(frames.some(f => f.file.includes('UserService'))).toBe(true);
    expect(frames.some(f => f.file.includes('FrameworkServlet'))).toBe(false);
  });

  it('createStackParser returns empty for non-stack output', () => {
    const parser = plugin.createStackParser();
    expect(parser.parseAndPrune('BUILD FAILURE', 'backend')).toHaveLength(0);
  });

  // ── NEW: getDebugAdapterSpec ───────────────────────────────────────────────
  it('getDebugAdapterSpec uses jdwp protocol', () => {
    expect(plugin.getDebugAdapterSpec()?.protocol).toBe('jdwp');
  });

  it('getDebugAdapterSpec port defaults to 5005', () => {
    expect(plugin.getDebugAdapterSpec()?.defaultPort).toBe(5005);
  });

  it('getDebugAdapterSpec launchCmdTemplate contains ${port}', () => {
    expect(plugin.getDebugAdapterSpec()?.launchCmdTemplate).toContain('${port}');
  });

  it('accepts custom debugPort via config', () => {
    const custom = new JavaPlugin(undefined, { debugPort: 5050 });
    expect(custom.getDebugAdapterSpec()?.defaultPort).toBe(5050);
  });
});

describe('SpringBootProfile', () => {
  const profile = new SpringBootProfile();

  it('matches Controller.java files', () => {
    expect(profile.matches('src/main/java/com/example/UserController.java')).toBe(true);
  });

  it('matches Resource.java files', () => {
    expect(profile.matches('src/main/java/com/example/OrderResource.java')).toBe(true);
  });

  it('matches Service.java files', () => {
    expect(profile.matches('src/main/java/com/example/UserService.java')).toBe(true);
  });

  it('does not match DTO files', () => {
    expect(profile.matches('src/main/java/com/example/UserDto.java')).toBe(false);
  });

  it('generates MockMvc test', () => {
    const scaffold = profile.generateTestTemplate(
      'src/main/java/com/example/UserController.java',
      { primaryBehaviourDescription: 'returns all users' },
    );
    expect(scaffold.testContent).toContain('@ExtendWith(MockitoExtension.class)');
    expect(scaffold.testContent).toContain('UserControllerTest');
  });
});
