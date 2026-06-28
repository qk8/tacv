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
