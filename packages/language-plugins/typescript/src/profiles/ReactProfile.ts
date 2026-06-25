import type { IFrameworkProfile, TestScaffold, TestSkeletonContext } from '@tacv/language-plugins-base';
import * as path from 'node:path';

export class ReactProfile implements IFrameworkProfile {
  readonly profileId = 'react'; readonly displayName = 'React'; readonly languageId = 'typescript';
  matches(f: string): boolean { return /src\/(components|pages|features|ui)\/.*\.tsx$/.test(f); }
  generateTestTemplate(sourceFile: string, ctx: TestSkeletonContext): TestScaffold {
    const name = path.basename(sourceFile, '.tsx');
    return {
      testFilePath: sourceFile.replace('.tsx', '.test.tsx'),
      testContent: `import { render, screen } from '@testing-library/react';\nimport userEvent from '@testing-library/user-event';\nimport { describe, it, expect, vi, beforeEach } from 'vitest';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  const user = userEvent.setup();\n  beforeEach(() => vi.clearAllMocks());\n\n  it('${ctx.primaryBehaviourDescription}', async () => {\n    // Arrange\n    render(<${name} />);\n    // Act + Assert\n    expect(screen.getByRole('main')).toBeInTheDocument();\n  });\n});`,
      framework: 'Vitest + @testing-library/react',
    };
  }
  generateE2eTestTemplate(feature: string, route: string): TestScaffold {
    return {
      testFilePath: `e2e/${feature.replace(/\s+/g, '-').toLowerCase()}.spec.ts`,
      testContent: `import { test, expect } from '@playwright/test';\nimport { VIEWPORTS } from '@tacv/visual-testing';\n\ntest.describe('${feature}', () => {\n  test('completes the happy path', async ({ page }) => {\n    await page.goto('${route}');\n    await expect(page).toHaveTitle(/${feature}/i);\n  });\n\n  for (const [device, viewport] of Object.entries(VIEWPORTS)) {\n    test(\`renders correctly on \${device}\`, async ({ page }) => {\n      await page.setViewportSize(viewport);\n      await page.goto('${route}');\n      await expect(page).toHaveScreenshot(\`${feature}-\${device}.png\`);\n    });\n  }\n});`,
      framework: 'Playwright',
    };
  }
  getActorHints(): string { return `## React\n- Functional components + hooks only\n- Co-locate tests: Component.tsx → Component.test.tsx\n- Use @testing-library/react queries by role\n- Playwright for E2E and visual regression`; }
  getLintRules(): Array<{ id: string; description: string }> { return [{ id: 'react/hooks-rules', description: 'Follow Rules of Hooks' }]; }
}
