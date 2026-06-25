import { describe, it, expect, vi } from 'vitest';
import { DockerSandboxProvider } from '../src/index.js';

vi.mock('execa', () => ({
  execa: vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === 'docker' && args[0] === 'run') return { stdout: 'abc123container', stderr: '', exitCode: 0 };
    if (cmd === 'docker' && args[0] === 'exec') return { stdout: 'build output', stderr: '', exitCode: 0 };
    if (cmd === 'docker' && args[0] === 'rm')   return { stdout: '', stderr: '', exitCode: 0 };
    return { stdout: '', stderr: '', exitCode: 0 };
  }),
}));

vi.mock('node:fs/promises', () => ({
  cp: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('DockerSandboxProvider', () => {
  const provider = new DockerSandboxProvider({ image: 'tacv-sandbox:latest', repoPath: '/tmp/repo' });

  it('returns a SandboxHandle with containerId', async () => {
    const handle = await provider.warmContainer();
    expect(handle.containerId).toContain('abc123');
    expect(handle.hostJdwpPort).toBeTypeOf('number');
    expect(handle.hostCdpPort).toBeTypeOf('number');
  });

  it('executes commands in container', async () => {
    const handle = await provider.warmContainer();
    const result = await provider.execInContainer(handle, 'echo hello');
    expect(result.stdout).toBe('build output');
    expect(result.exitCode).toBe(0);
  });

  it('destroys container without throwing', async () => {
    const handle = await provider.warmContainer();
    await expect(provider.destroyContainer(handle)).resolves.toBeUndefined();
  });
});
