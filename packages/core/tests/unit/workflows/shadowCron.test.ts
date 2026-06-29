import { describe, it, expect } from 'vitest';

describe('ShadowModeCronWorkflow', () => {
  it('exports from workflows index', async () => {
    const workflows = await import('../../../src/workflows/index.js');
    expect(workflows.ShadowModeCronWorkflow).toBeDefined();
  });

  it('has shadowMode config with cronSchedule', async () => {
    const { ShadowModeConfig } = await import('../../../src/config/index.js');
    const config = ShadowModeConfig.parse({});
    expect(config.cronSchedule).toBe('0 2 * * *');
    expect(config.enabled).toBe(false);
    expect(config.maxTasksPerRun).toBe(3);
  });
});
