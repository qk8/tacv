import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, WorkflowConfig } from '../../../src/config/index.js';

describe('loadConfig', () => {
  it('returns full defaults when no path given', () => {
    const cfg = loadConfig();
    expect(cfg.maxSelfCorrectionCycles).toBe(6);
    expect(cfg.tokenBudget.criticalDollar).toBe(80);
    expect(cfg.mutation.enabled).toBe(false);
    expect(cfg.visual.enabled).toBe(false);
    expect(cfg.langfuse.enabled).toBe(false);
  });

  it('throws on invalid config values', () => {
    expect(() => WorkflowConfig.parse({ maxSelfCorrectionCycles: 0 })).toThrow();
    expect(() => WorkflowConfig.parse({ confidenceEscalationThreshold: 2 })).toThrow();
  });

  it('validates nested tokenBudget', () => {
    const cfg = WorkflowConfig.parse({ tokenBudget: { criticalDollar: 100, warningDollar: 60, costPerMInput: 3, costPerMOutput: 15 } });
    expect(cfg.tokenBudget.criticalDollar).toBe(100);
  });

  it('defaults to in-memory vector store', () => {
    expect(loadConfig().mem0VectorStore).toBe('in-memory');
  });

  it('accepts valid viewport list', () => {
    const cfg = WorkflowConfig.parse({ visual: { viewports: ['mobile', 'desktop'] } });
    expect(cfg.visual.viewports).toContain('mobile');
  });

  it('loads config from a JSON file path using ESM-compatible reads', async () => {
    const dir = await mkdtemp(join(await tmpdir(), 'tacv-config-'));
    const configPath = join(dir, 'tacv.json');
    const rawConfig = { maxSelfCorrectionCycles: 12, agentModel: 'claude-sonnet-4-20250514' };
    await writeFile(configPath, JSON.stringify(rawConfig));

    const cfg = loadConfig(configPath);
    expect(cfg.maxSelfCorrectionCycles).toBe(12);
    expect(cfg.agentModel).toBe('claude-sonnet-4-20250514');

    await rm(dir, { recursive: true, force: true });
  });

  it('gracefully handles missing config file', () => {
    const cfg = loadConfig('/nonexistent/path/tacv.json');
    expect(cfg).toBeDefined();
    expect(cfg.maxSelfCorrectionCycles).toBe(6); // falls back to defaults
  });
});

describe('skipTddGate config', () => {
  it('defaults to false', () => {
    const cfg = WorkflowConfig.parse({});
    expect(cfg.skipTddGate).toBe(false);
  });

  it('can be set to true to skip TDD gate', () => {
    const cfg = WorkflowConfig.parse({ skipTddGate: true });
    expect(cfg.skipTddGate).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(() => WorkflowConfig.parse({ skipTddGate: 'yes' })).toThrow();
  });
});

describe('languageConfig', () => {
  it('defaults to empty object', () => {
    const cfg = WorkflowConfig.parse({});
    expect(cfg.languageConfig).toBeDefined();
    expect(cfg.languageConfig.typescript).toBeUndefined();
    expect(cfg.languageConfig.java).toBeUndefined();
  });

  it('accepts Java language-specific config', () => {
    const cfg = WorkflowConfig.parse({
      languageConfig: {
        java: { userPackage: 'com.acme.myapp', debugPort: 5005, actuatorBaseUrl: 'http://localhost:8080/actuator' },
      },
    });
    expect(cfg.languageConfig.java?.userPackage).toBe('com.acme.myapp');
    expect(cfg.languageConfig.java?.debugPort).toBe(5005);
    expect(cfg.languageConfig.java?.actuatorBaseUrl).toBe('http://localhost:8080/actuator');
  });

  it('accepts TypeScript language-specific config', () => {
    const cfg = WorkflowConfig.parse({
      languageConfig: {
        typescript: { userSrcRoot: 'src', debugPort: 9229 },
      },
    });
    expect(cfg.languageConfig.typescript?.userSrcRoot).toBe('src');
    expect(cfg.languageConfig.typescript?.debugPort).toBe(9229);
  });

  it('accepts both languages simultaneously', () => {
    const cfg = WorkflowConfig.parse({
      languageConfig: {
        typescript: { userSrcRoot: 'app', debugPort: 9230 },
        java: { userPackage: 'org.example', debugPort: 5006, actuatorBaseUrl: 'http://localhost:9090/actuator' },
      },
    });
    expect(cfg.languageConfig.typescript?.userSrcRoot).toBe('app');
    expect(cfg.languageConfig.java?.userPackage).toBe('org.example');
  });
});
