import type { IFrameworkProfile, TestScaffold, TestSkeletonContext } from '@tacv/language-plugins-base';
import * as path from 'node:path';

export class NextJsProfile implements IFrameworkProfile {
  readonly profileId   = 'nextjs';
  readonly displayName = 'Next.js';
  readonly languageId  = 'typescript';

  matches(f: string): boolean {
    return /app\/.*\.(tsx?|page\.tsx?)$/.test(f) || /pages\/.*\.tsx?$/.test(f);
  }

  generateTestTemplate(sourceFile: string, ctx: TestSkeletonContext): TestScaffold {
    const name = path.basename(sourceFile, path.extname(sourceFile));
    return {
      testFilePath: sourceFile.replace(/\.(tsx?)$/, '.test.$1'),
      testContent: `import { render, screen } from '@testing-library/react';\nimport { describe, it, expect, vi } from 'vitest';\nimport ${name} from './${name}';\n\n// Mock Next.js router\nvi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));\n\ndescribe('${name}', () => {\n  it('${ctx.primaryBehaviourDescription}', async () => {\n    render(<${name} />);\n    // TODO: assert expected elements\n    expect(screen.getByRole('main')).toBeInTheDocument();\n  });\n});`,
      framework: 'Vitest + @testing-library/react + next/navigation mock',
    };
  }

  generateE2eTestTemplate(feature: string, route: string): TestScaffold {
    return {
      testFilePath: `e2e/${feature.replace(/\s+/g,'-').toLowerCase()}.spec.ts`,
      testContent: `import { test, expect } from '@playwright/test';\nimport { VIEWPORTS } from '@tacv/visual-testing';\n\ntest.describe('${feature}', () => {\n  test('page loads and is interactive', async ({ page }) => {\n    await page.goto('${route}');\n    await page.waitForLoadState('networkidle');\n    await expect(page).toHaveTitle(/${feature}/i);\n  });\n\n  for (const [device, viewport] of Object.entries(VIEWPORTS)) {\n    test(\`responsive on \${device}\`, async ({ page }) => {\n      await page.setViewportSize(viewport);\n      await page.goto('${route}');\n      await expect(page).toHaveScreenshot(\`${feature}-\${device}.png\`);\n    });\n  }\n});`,
      framework: 'Playwright',
    };
  }

  getActorHints(): string {
    return `## Next.js App Router Conventions\n- Server Components by default, 'use client' only when needed\n- Route handlers in app/api/**/route.ts\n- Use next/image for images (auto-optimised)\n- Mock next/navigation (useRouter, usePathname) in tests\n- generateMetadata() for SEO metadata`;
  }

  getLintRules(): Array<{ id: string; description: string }> {
    return [{ id: 'next/no-html-link-for-pages', description: 'Use <Link> not <a> for navigation' }];
  }
}
