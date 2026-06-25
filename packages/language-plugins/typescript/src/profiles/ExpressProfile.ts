import type { IFrameworkProfile, TestScaffold, TestSkeletonContext } from '@tacv/language-plugins-base';
import * as path from 'node:path';

export class ExpressProfile implements IFrameworkProfile {
  readonly profileId   = 'express';
  readonly displayName = 'Express.js';
  readonly languageId  = 'typescript';

  matches(f: string): boolean {
    return /src\/(routes?|controllers?|handlers?)\/.*\.ts$/.test(f) && !f.includes('fastify');
  }

  generateTestTemplate(sourceFile: string, ctx: TestSkeletonContext): TestScaffold {
    const name = path.basename(sourceFile, '.ts');
    return {
      testFilePath: sourceFile.replace('.ts', '.test.ts'),
      testContent: `import { describe, it, expect, beforeAll, afterAll } from 'vitest';\nimport request from 'supertest';\nimport { app } from '../app.js';\n\ndescribe('${name}', () => {\n  it('${ctx.primaryBehaviourDescription}', async () => {\n    const res = await request(app)\n      .get('/api/${name}')\n      .set('Accept', 'application/json');\n    expect(res.status).toBe(200);\n    expect(res.body).toBeDefined();\n  });\n\n  it('returns 400 on invalid input', async () => {\n    const res = await request(app).post('/api/${name}').send({});\n    expect(res.status).toBe(400);\n  });\n});`,
      framework: 'Vitest + supertest',
    };
  }

  getActorHints(): string {
    return `## Express.js Conventions\n- Use express-validator for request validation\n- Centralised error handler middleware at the end\n- Use supertest for integration tests\n- Router files in src/routes/, controllers in src/controllers/\n- next(err) for async errors`;
  }

  getLintRules(): Array<{ id: string; description: string }> {
    return [{ id: 'express/no-next-without-catch', description: 'Wrap async handlers with try/catch + next(err)' }];
  }
}
