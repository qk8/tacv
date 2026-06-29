import { describe, it, expect } from 'vitest';
import { WorkflowConfig, HitlConfig, loadConfig } from '../../src/config/index.js';

describe('HitlConfig', () => {
  it('defaults to 48 hours wait timeout', () => {
    const config = WorkflowConfig.parse({});
    expect(config.hitl.waitTimeout).toBe('48 hours');
  });

  it('accepts custom wait timeout', () => {
    const config = WorkflowConfig.parse({ hitl: { waitTimeout: '4 hours' } });
    expect(config.hitl.waitTimeout).toBe('4 hours');
  });

  it('accepts zero to disable HITL wait (auto-reject)', () => {
    const config = WorkflowConfig.parse({ hitl: { waitTimeout: '0 hours' } });
    expect(config.hitl.waitTimeout).toBe('0 hours');
  });
});

describe('loadConfig hitl', () => {
  it('preserves hitl config from JSON', () => {
    const raw = JSON.stringify({ hitl: { waitTimeout: '2 hours' } });
    const config = WorkflowConfig.parse(JSON.parse(raw));
    expect(config.hitl.waitTimeout).toBe('2 hours');
  });

  it('uses default hitl when not specified', () => {
    const config = WorkflowConfig.parse({});
    expect(config.hitl.waitTimeout).toBe('48 hours');
  });
});
