import type { IFrameworkProfile, TestScaffold, TestSkeletonContext } from '@tacv/language-plugins-base';
import * as path from 'node:path';

export class SpringBootProfile implements IFrameworkProfile {
  readonly profileId = 'spring-boot'; readonly displayName = 'Spring Boot'; readonly languageId = 'java';
  matches(f: string): boolean { return /(Controller|Resource|Service|Repository|Component)\.java$/.test(f); }
  generateTestTemplate(sourceFile: string, ctx: TestSkeletonContext): TestScaffold {
    const cls = path.basename(sourceFile, '.java');
    const pkg = this._inferPackage(sourceFile);
    return {
      testFilePath: sourceFile.replace('/main/', '/test/').replace('.java', 'Test.java'),
      testContent: `package ${pkg};\n\nimport org.junit.jupiter.api.*;\nimport org.junit.jupiter.api.extension.ExtendWith;\nimport org.mockito.InjectMocks;\nimport org.mockito.Mock;\nimport org.mockito.junit.jupiter.MockitoExtension;\nimport static org.assertj.core.api.Assertions.*;\nimport static org.mockito.Mockito.*;\n\n@ExtendWith(MockitoExtension.class)\n@DisplayName("${cls} Tests")\nclass ${cls}Test {\n\n    @InjectMocks\n    private ${cls} sut;\n\n    @BeforeEach\n    void setUp() { /* setup fixtures */ }\n\n    @Test\n    @DisplayName("${ctx.primaryBehaviourDescription}")\n    void should_${ctx.methodName ?? 'execute'}_when_valid_input() {\n        // Arrange\n        // Act\n        // Assert\n        fail("Test not yet implemented");\n    }\n}`,
      framework: 'JUnit 5 + Mockito + AssertJ',
    };
  }
  generateE2eTestTemplate(feature: string, _route: string): TestScaffold {
    const cls = feature.replace(/\s+/g, '') + 'IT';
    return {
      testFilePath: `src/test/java/com/example/${cls}.java`,
      testContent: `@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)\n@AutoConfigureMockMvc\nclass ${cls} {\n    @Autowired MockMvc mvc;\n    @Test void should_return_200() throws Exception {\n        mvc.perform(get("/api/health")).andExpect(status().isOk());\n    }\n}`,
      framework: 'Spring Boot Test + MockMvc',
    };
  }
  getActorHints(): string { return '## Spring Boot\n- @Service/@Repository for DI\n- @Transactional on service methods\n- Use ResponseEntity for controllers\n- Constructor injection (not field injection)\n- @Valid on request bodies'; }
  getLintRules(): Array<{ id: string; description: string }> { return [{ id: 'spring/no-field-injection', description: 'Use constructor injection' }]; }
  private _inferPackage(filePath: string): string {
    const m = filePath.match(/src\/main\/java\/(.+)\/[^/]+\.java$/);
    return m?.[1]?.replace(/\//g, '.') ?? 'com.example';
  }
}
