import type { IFrameworkProfile, TestScaffold, TestSkeletonContext } from '@tacv/language-plugins-base';
import * as path from 'node:path';

export class FastifyProfile implements IFrameworkProfile {
  readonly profileId = 'fastify'; readonly displayName = 'Fastify'; readonly languageId = 'typescript';
  matches(f: string): boolean { return /src\/(routes|plugins|handlers)\/.*\.ts$/.test(f); }
  generateTestTemplate(sourceFile: string, ctx: TestSkeletonContext): TestScaffold {
    const name = path.basename(sourceFile, '.ts');
    return {
      testFilePath: sourceFile.replace('.ts', '.test.ts'),
      testContent: `import { describe, it, expect, beforeAll, afterAll } from 'vitest';\nimport { build } from '../app.js';\nimport type { FastifyInstance } from 'fastify';\n\ndescribe('${name}', () => {\n  let app: FastifyInstance;\n  beforeAll(async () => { app = await build({ logger: false }); await app.ready(); });\n  afterAll(() => app.close());\n\n  it('${ctx.primaryBehaviourDescription}', async () => {\n    const response = await app.inject({ method: 'GET', url: '/api/${name}' });\n    expect(response.statusCode).toBe(200);\n  });\n});`,
      framework: 'Vitest + Fastify inject',
    };
  }
  getActorHints(): string { return `## Fastify\n- Use TypeBox or Zod for request/reply schemas\n- Use fastify-plugin for scope encapsulation\n- reply.notFound() not new Error(404)`; }
  getLintRules(): Array<{ id: string; description: string }> { return []; }
}
