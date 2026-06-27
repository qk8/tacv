import { describe, it, expect, vi } from 'vitest';
import type { DebugAdapterSpec } from '@tacv/language-plugins-base';

// ── Mock the concrete adapters so we don't need their heavy deps ──────────────
vi.mock('../src/adapters/CdpDebugAdapter.js',  () => ({
  CdpDebugAdapter:  class { name = 'cdp'; connect = vi.fn(); disconnect = vi.fn(); setBreakpoint = vi.fn(); },
}));
vi.mock('../src/adapters/JdwpDebugAdapter.js', () => ({
  JdwpDebugAdapter: class { name = 'jdwp'; connect = vi.fn(); disconnect = vi.fn(); setBreakpoint = vi.fn(); },
}));
vi.mock('../src/adapters/DapDebugAdapter.js',  () => ({
  DapDebugAdapter:  class { name = 'dap'; connect = vi.fn(); disconnect = vi.fn(); setBreakpoint = vi.fn(); },
}));

import { createDebugAdapter, buildLaunchCmd } from '../src/DebugAdapterFactory.js';

describe('createDebugAdapter()', () => {
  it('returns null for protocol=none', () => {
    const spec: DebugAdapterSpec = { protocol: 'none', defaultPort: 0, launchCmdTemplate: '' };
    expect(createDebugAdapter(spec)).toBeNull();
  });

  it('returns cdp adapter', () => {
    const spec: DebugAdapterSpec = { protocol: 'cdp', defaultPort: 9229, launchCmdTemplate: 'node --inspect-brk=${port}' };
    expect(createDebugAdapter(spec)?.name).toBe('cdp');
  });

  it('returns jdwp adapter', () => {
    const spec: DebugAdapterSpec = { protocol: 'jdwp', defaultPort: 5005, launchCmdTemplate: 'mvn test' };
    expect(createDebugAdapter(spec)?.name).toBe('jdwp');
  });

  it('returns dap adapter', () => {
    const spec: DebugAdapterSpec = { protocol: 'dap', defaultPort: 4711, launchCmdTemplate: 'python -m debugpy' };
    expect(createDebugAdapter(spec)?.name).toBe('dap');
  });

  it('adapter exposes connect/disconnect/setBreakpoint', () => {
    const spec: DebugAdapterSpec = { protocol: 'cdp', defaultPort: 9229, launchCmdTemplate: 'node --inspect-brk=${port}' };
    const adapter = createDebugAdapter(spec)!;
    expect(typeof adapter.connect).toBe('function');
    expect(typeof adapter.disconnect).toBe('function');
    expect(typeof adapter.setBreakpoint).toBe('function');
  });
});

describe('buildLaunchCmd()', () => {
  it('substitutes ${port} with defaultPort', () => {
    const spec: DebugAdapterSpec = { protocol: 'jdwp', defaultPort: 5005, launchCmdTemplate: 'mvn test -Ddebug=${port}' };
    expect(buildLaunchCmd(spec)).toBe('mvn test -Ddebug=5005');
  });

  it('allows port override', () => {
    const spec: DebugAdapterSpec = { protocol: 'cdp', defaultPort: 9229, launchCmdTemplate: 'node --inspect-brk=${port}' };
    expect(buildLaunchCmd(spec, 9230)).toBe('node --inspect-brk=9230');
  });

  it('replaces all occurrences of ${port}', () => {
    const spec: DebugAdapterSpec = { protocol: 'cdp', defaultPort: 9229, launchCmdTemplate: 'node --inspect-brk=0.0.0.0:${port} --debug-port=${port}' };
    expect(buildLaunchCmd(spec)).toBe('node --inspect-brk=0.0.0.0:9229 --debug-port=9229');
  });
});
