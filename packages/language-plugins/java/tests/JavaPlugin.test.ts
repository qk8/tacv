import { describe, it, expect } from 'vitest';
import { JavaPlugin } from '../src/JavaPlugin.js';
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
    const scaffold = await plugin.generateTestSkeleton('src/main/java/com/example/UserService.java', { primaryBehaviourDescription: 'creates a user' });
    expect(scaffold.testContent).toContain('@Test');
    expect(scaffold.testFilePath).toContain('Test.java');
  });

  it('routes SpringBoot controllers to SpringBootProfile', () => {
    expect(plugin.getProfileFor('src/main/java/com/example/UserController.java')?.profileId).toBe('spring-boot');
  });
});

describe('SpringBootProfile', () => {
  const profile = new SpringBootProfile();

  it('matches Controller files', () => {
    expect(profile.matches('src/main/java/com/example/UserController.java')).toBe(true);
    expect(profile.matches('src/main/java/com/example/UserService.java')).toBe(true);
  });

  it('does not match DTO files', () => {
    expect(profile.matches('src/main/java/com/example/UserDto.java')).toBe(false);
  });

  it('generates MockMvc test', () => {
    const scaffold = profile.generateTestTemplate('src/main/java/com/example/UserController.java', { primaryBehaviourDescription: 'returns all users' });
    expect(scaffold.testContent).toContain('@ExtendWith(MockitoExtension.class)');
    expect(scaffold.testContent).toContain('UserControllerTest');
  });
});
