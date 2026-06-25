import type { IFrameworkProfile, TestScaffold, TestSkeletonContext } from '@tacv/language-plugins-base';
import * as path from 'node:path';

export class VueProfile implements IFrameworkProfile {
  readonly profileId   = 'vue';
  readonly displayName = 'Vue.js';
  readonly languageId  = 'typescript';

  matches(f: string): boolean {
    return f.endsWith('.vue') || /src\/(components|views|pages)\/.*\.ts$/.test(f);
  }

  generateTestTemplate(sourceFile: string, ctx: TestSkeletonContext): TestScaffold {
    const name = path.basename(sourceFile).replace(/\.(vue|ts)$/, '');
    const isVue = sourceFile.endsWith('.vue');
    return {
      testFilePath: sourceFile.replace(/\.(vue|ts)$/, '.test.ts'),
      testContent: isVue
        ? `import { mount } from '@vue/test-utils';\nimport { describe, it, expect, vi } from 'vitest';\nimport ${name} from './${name}.vue';\n\ndescribe('${name}', () => {\n  it('${ctx.primaryBehaviourDescription}', () => {\n    const wrapper = mount(${name});\n    expect(wrapper.exists()).toBe(true);\n  });\n\n  it('emits expected events', async () => {\n    const wrapper = mount(${name});\n    // TODO: trigger interaction and assert emit\n    expect(wrapper.emitted()).toBeDefined();\n  });\n});`
        : `import { describe, it, expect, vi } from 'vitest';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('${ctx.primaryBehaviourDescription}', () => {\n    // Arrange, Act, Assert\n    expect(true).toBe(true);\n  });\n});`,
      framework: 'Vitest + @vue/test-utils',
    };
  }

  generateE2eTestTemplate(feature: string, route: string): TestScaffold {
    return {
      testFilePath: `e2e/${feature.replace(/\s+/g,'-').toLowerCase()}.spec.ts`,
      testContent: `import { test, expect } from '@playwright/test';\nimport { VIEWPORTS } from '@tacv/visual-testing';\n\ntest.describe('${feature}', () => {\n  test('renders on desktop', async ({ page }) => {\n    await page.goto('${route}');\n    await expect(page.locator('[data-testid="main"]')).toBeVisible();\n  });\n\n  for (const [device, viewport] of Object.entries(VIEWPORTS)) {\n    test(\`visual regression on \${device}\`, async ({ page }) => {\n      await page.setViewportSize(viewport);\n      await page.goto('${route}');\n      await expect(page).toHaveScreenshot(\`${feature}-\${device}.png\`);\n    });\n  }\n});`,
      framework: 'Playwright',
    };
  }

  getActorHints(): string {
    return `## Vue.js Conventions\n- Composition API with <script setup> syntax\n- defineProps / defineEmits with TypeScript types\n- Use @vue/test-utils for unit tests (mount, wrapper.find, wrapper.emitted)\n- Pinia for state management\n- useRouter() / useRoute() composables`;
  }

  getLintRules(): Array<{ id: string; description: string }> {
    return [
      { id: 'vue/script-setup', description: 'Prefer <script setup> syntax' },
      { id: 'vue/no-v-html',    description: 'Avoid v-html to prevent XSS' },
    ];
  }
}
