import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DockerSandboxProvider, type DockerSandboxConfig } from './DockerSandboxProvider.js';

// ── Mock execa ────────────────────────────────────────────────────────────────
const mockExeca = vi.fn();
vi.mock('execa', () => ({ execa: mockExeca }));

// ── Mock fs ───────────────────────────────────────────────────────────────────
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm:    vi.fn().mockResolvedValue(undefined),
  cp:    vi.fn().mockResolvedValue(undefined),
}));

// ── Mock require('node:fs').statSync ──────────────────────────────────────────
vi.mock('node:fs', () => ({
  statSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DockerSandboxConfig> = {}): DockerSandboxConfig {
  return { repoPath: '/tmp/test-repo', image: 'tacv-sandbox:latest', runtime: 'runc', ...overrides };
}

function stubDockerRun(containerId = 'abc123container456'): void {
  mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === 'docker' && args[0] === 'run')     return { stdout: containerId, stderr: '', exitCode: 0 };
    if (cmd === 'docker' && args[0] === 'exec')    return { stdout: 'output', stderr: '', exitCode: 0 };
    if (cmd === 'docker' && args[0] === 'rm')      return { stdout: '', stderr: '', exitCode: 0 };
    if (cmd === 'docker' && args[0] === 'image')   return { stdout: '{}', stderr: '', exitCode: 0 };
    if (cmd === 'mount')                            return { stdout: '', stderr: '', exitCode: 0 };
    if (cmd === 'umount')                           return { stdout: '', stderr: '', exitCode: 0 };
    if (cmd === 'runsc')                            return { stdout: 'runsc version 20240101', stderr: '', exitCode: 0 };
    return { stdout: '', stderr: '', exitCode: 0 };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DockerSandboxProvider', () => {
  beforeEach(() => { vi.clearAllMocks(); stubDockerRun(); });
  afterEach(() => vi.restoreAllMocks());

  // ── validateImage ─────────────────────────────────────────────────────────

  describe('validateImage', () => {
    it('passes when docker image inspect succeeds', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await expect(provider.validateImage()).resolves.toBeUndefined();
      expect(mockExeca).toHaveBeenCalledWith('docker', ['image', 'inspect', 'tacv-sandbox:latest']);
    });

    it('throws descriptive error when image is missing', async () => {
      mockExeca.mockRejectedValueOnce(new Error('No such image'));
      const provider = new DockerSandboxProvider(makeConfig());
      await expect(provider.validateImage()).rejects.toThrow(/tacv-sandbox:latest/);
      await expect(provider.validateImage()).rejects.toThrow(/docker build/);
    });
  });

  // ── warmContainer ─────────────────────────────────────────────────────────

  describe('warmContainer', () => {
    it('returns a handle with containerId, ports, and workingDir', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      expect(handle.containerId).toBe('abc123container456');
      expect(handle.hostJdwpPort).toBeTypeOf('number');
      expect(handle.hostCdpPort).toBeTypeOf('number');
      expect(handle.workingDir).toContain('/tmp/tacv');
    });

    it('JDWP and CDP ports are different', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      expect(handle.hostJdwpPort).not.toBe(handle.hostCdpPort);
    });

    it('passes --network none to docker run', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = runCall?.[1] as string[];
      const idx  = args.indexOf('--network');
      expect(args[idx + 1]).toBe('none');
    });

    it('passes --read-only flag', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      expect(runCall?.[1]).toContain('--read-only');
    });

    it('passes --pids-limit', async () => {
      const provider = new DockerSandboxProvider(makeConfig({ pidsLimit: 128 }));
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = runCall?.[1] as string[];
      const idx  = args.indexOf('--pids-limit');
      expect(args[idx + 1]).toBe('128');
    });

    it('passes memory limit', async () => {
      const provider = new DockerSandboxProvider(makeConfig({ memoryBytes: 512 * 1024 * 1024 }));
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = runCall?.[1] as string[];
      const idx  = args.indexOf('--memory');
      expect(args[idx + 1]).toBe(String(512 * 1024 * 1024));
    });

    it('mounts workDir as /workspace:rw', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      const runCall  = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = (runCall?.[1] as string[]).join(' ');
      expect(args).toContain(`${handle.workingDir}:/workspace:rw`);
    });

    it('mounts JDWP and CDP ports', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      const runCall  = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = (runCall?.[1] as string[]).join(' ');
      expect(args).toContain(`${handle.hostJdwpPort}:5005`);
      expect(args).toContain(`${handle.hostCdpPort}:9229`);
    });

    it('passes --security-opt no-new-privileges:true', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      expect((runCall?.[1] as string[]).join(' ')).toContain('no-new-privileges:true');
    });

    it('starts container with sleep infinity', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = runCall?.[1] as string[];
      expect(args.slice(-2)).toEqual(['sleep', 'infinity']);
    });

    it('attempts to mount overlayfs', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.warmContainer();
      const mountCall = mockExeca.mock.calls.find(c => c[0] === 'mount');
      expect(mountCall).toBeDefined();
      const mountArgs = (mountCall?.[1] as string[]).join(' ');
      expect(mountArgs).toContain('overlay');
      expect(mountArgs).toContain(makeConfig().repoPath);
    });

    it('falls back to plain copy when overlayfs unavailable', async () => {
      const { cp } = await import('node:fs/promises');
      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'mount') throw new Error('Operation not permitted (requires root)');
        if (cmd === 'docker' && args[0] === 'run') return { stdout: 'ctr123', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      });
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.warmContainer();
      expect(cp).toHaveBeenCalled();
    });
  });

  // ── execInContainer ───────────────────────────────────────────────────────

  describe('execInContainer', () => {
    it('returns stdout/stderr/exitCode on success', async () => {
      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'docker' && args[0] === 'exec') return { stdout: 'BUILD SUCCESS', stderr: '', exitCode: 0 };
        if (cmd === 'docker' && args[0] === 'run')  return { stdout: 'ctr-abc', stderr: '', exitCode: 0 };
        if (cmd === 'mount')                         return { stdout: '', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      });
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      const result   = await provider.execInContainer(handle, 'mvn test -q');
      expect(result.stdout).toBe('BUILD SUCCESS');
      expect(result.exitCode).toBe(0);
    });

    it('returns non-zero exit code without throwing', async () => {
      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'docker' && args[0] === 'exec') throw Object.assign(new Error('test failed'), { stdout: '', stderr: 'TESTS FAILED', exitCode: 1 });
        if (cmd === 'docker' && args[0] === 'run')  return { stdout: 'ctr-abc', stderr: '', exitCode: 0 };
        if (cmd === 'mount')                         return { stdout: '', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      });
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      const result   = await provider.execInContainer(handle, 'mvn test');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('TESTS FAILED');
    });

    it('passes environment variables', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      vi.clearAllMocks();
      mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await provider.execInContainer(handle, 'echo $SPRING_PROFILES_ACTIVE', { env: { SPRING_PROFILES_ACTIVE: 'test' } });
      const execCall = mockExeca.mock.calls[0];
      expect((execCall?.[1] as string[]).join(' ')).toContain('-e SPRING_PROFILES_ACTIVE=test');
    });

    it('uses custom working directory when specified', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      vi.clearAllMocks();
      mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await provider.execInContainer(handle, 'npm test', { workingDir: '/workspace/packages/core' });
      const execCall = mockExeca.mock.calls[0];
      const args = (execCall?.[1] as string[]).join(' ');
      expect(args).toContain('-w /workspace/packages/core');
    });
  });

  // ── destroyContainer ──────────────────────────────────────────────────────

  describe('destroyContainer', () => {
    it('calls docker rm -f with containerId', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      vi.clearAllMocks();
      mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      const { rm } = await import('node:fs/promises');
      await provider.destroyContainer(handle);
      const rmCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'rm',
      );
      expect(rmCall?.[1]).toContain('-f');
      expect(rmCall?.[1]).toContain(handle.containerId);
    });

    it('unmounts overlayfs after destroying container', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      vi.clearAllMocks();
      mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await provider.destroyContainer(handle);
      const umountCall = mockExeca.mock.calls.find(c => c[0] === 'umount');
      expect(umountCall).toBeDefined();
    });

    it('does not throw if umount fails (fallback was used)', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      vi.clearAllMocks();
      mockExeca.mockImplementation(async (cmd: string) => {
        if (cmd === 'umount') throw new Error('not mounted');
        return { stdout: '', stderr: '', exitCode: 0 };
      });
      await expect(provider.destroyContainer(handle)).resolves.toBeUndefined();
    });

    it('removes overlay mount directory from disk', async () => {
      const { rm } = await import('node:fs/promises');
      const provider = new DockerSandboxProvider(makeConfig());
      const handle   = await provider.warmContainer();
      vi.clearAllMocks();
      mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await provider.destroyContainer(handle);
      expect(rm).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
    });
  });

  // ── Runtime auto-detection ────────────────────────────────────────────────

  describe('runtime auto-detection (runtime: auto)', () => {
    it('selects runsc when gVisor is available', async () => {
      const provider = new DockerSandboxProvider(makeConfig({ runtime: 'auto' }));
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = runCall?.[1] as string[];
      expect(args[args.indexOf('--runtime') + 1]).toBe('runsc');
    });

    it('falls back to runc when gVisor not installed', async () => {
      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'runsc')                        throw new Error('runsc: command not found');
        if (cmd === 'docker' && args[0] === 'run')  return { stdout: 'ctr-fallback', stderr: '', exitCode: 0 };
        if (cmd === 'mount')                         return { stdout: '', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      });
      const provider = new DockerSandboxProvider(makeConfig({ runtime: 'auto' }));
      await provider.warmContainer();
      const runCall = mockExeca.mock.calls.find(
        c => c[0] === 'docker' && (c[1] as string[])[0] === 'run',
      );
      const args = runCall?.[1] as string[];
      expect(args[args.indexOf('--runtime') + 1]).toBe('runc');
    });
  });
});
