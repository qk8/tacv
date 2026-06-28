import { execa }   from 'execa';
import * as fs     from 'node:fs/promises';
import * as net    from 'node:net';
import * as crypto from 'node:crypto';
import * as path   from 'node:path';
import type { ISandboxProvider, SandboxHandle, ExecResult, ExecOptions } from '@tacv/core/interfaces';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.docker');

export interface DockerSandboxConfig {
  /**
   * OCI image to use for the sandbox.
   * For TypeScript projects: tacv-sandbox:latest (see docker/sandbox/Dockerfile.sandbox)
   * For Java projects:       tacv-java-sandbox:latest (see docker/sandbox/Dockerfile.java-sandbox)
   */
  image?:     string;

  /** Absolute path to the repository to mount read-only as the overlayfs lower layer. */
  repoPath:   string;

  /** Working directory for overlayfs mounts. Defaults to /tmp/tacv. */
  mountRoot?: string;

  /**
   * Runtime to use.
   * 'runsc'   — gVisor kernel sandbox (production, requires gVisor installed)
   * 'runc'    — standard runc (development, less isolated)
   * 'auto'    — try runsc, fall back to runc silently
   */
  runtime?:   'runsc' | 'runc' | 'auto';

  /** Memory limit in bytes. Defaults to 1 GiB. */
  memoryBytes?: number;

  /** CPU quota in microseconds per period. Defaults to 1 full core (100_000/100_000). */
  cpuQuota?:    number;
  cpuPeriod?:   number;

  /** Max PIDs inside the container. Prevents fork bombs. Defaults to 256. */
  pidsLimit?:   number;

  /** Absolute path to a custom seccomp profile JSON. */
  seccompProfilePath?: string;

  /** Timeout for docker exec calls in ms. Defaults to 120_000 (2 min). */
  execTimeoutMs?: number;
}

/**
 * ISandboxProvider implementation using Docker with:
 *
 *  - gVisor (runsc) for kernel-level isolation of AI-generated code
 *  - overlayfs copy-on-write mounts so each branch gets a full repo view
 *    with zero copying — only branch-written files go into the upper layer
 *  - Network isolation (--network none)
 *  - Read-only root filesystem with tmpfs at /tmp
 *  - no-new-privileges + seccomp allowlist
 *  - PID limit to prevent fork bombs
 *  - Hard memory + CPU caps
 *
 * gVisor installation: https://gvisor.dev/docs/user_guide/install/
 * Required in /etc/docker/daemon.json:
 *   { "runtimes": { "runsc": { "path": "/usr/local/bin/runsc" } } }
 */
export class DockerSandboxProvider implements ISandboxProvider {
  private readonly cfg: Required<DockerSandboxConfig>;

  constructor(config: DockerSandboxConfig) {
    this.cfg = {
      image:              config.image              ?? 'tacv-sandbox:latest',
      repoPath:           config.repoPath,
      mountRoot:          config.mountRoot          ?? '/tmp/tacv',
      runtime:            config.runtime            ?? 'auto',
      memoryBytes:        config.memoryBytes        ?? 1_073_741_824,   // 1 GiB
      cpuQuota:           config.cpuQuota           ?? 100_000,          // 1 core
      cpuPeriod:          config.cpuPeriod          ?? 100_000,
      pidsLimit:          config.pidsLimit          ?? 256,
      seccompProfilePath: config.seccompProfilePath ?? path.join(__dirname, '..', 'seccomp-profile.json'),
      execTimeoutMs:      config.execTimeoutMs      ?? 120_000,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async validateImage(): Promise<void> {
    try {
      await execa('docker', ['image', 'inspect', this.cfg.image]);
      log.info('sandbox.image_valid', { image: this.cfg.image });
    } catch {
      throw new Error(
        `Docker image '${this.cfg.image}' not found. ` +
        `Build it with: docker build -t ${this.cfg.image} docker/sandbox/`,
      );
    }
  }

  async warmContainer(): Promise<SandboxHandle> {
    const [jdwpPort, cdpPort] = await Promise.all([this._freePort(), this._freePort()]);
    const workDir = await this._createOverlayfsMount();

    const runtime  = await this._resolveRuntime();
    const runArgs  = this._buildRunArgs(workDir, jdwpPort, cdpPort, runtime);
    const { stdout } = await execa('docker', runArgs);
    const containerId = stdout.trim();

    log.info('sandbox.started', {
      containerId: containerId.slice(0, 12),
      runtime, jdwpPort, cdpPort, workDir,
      image: this.cfg.image,
    });

    return { containerId, workingDir: workDir, hostJdwpPort: jdwpPort, hostCdpPort: cdpPort };
  }

  async execInContainer(
    handle:  SandboxHandle,
    command: string,
    opts?:   ExecOptions,
  ): Promise<ExecResult> {
    const envArgs = opts?.env
      ? Object.entries(opts.env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
      : [];

    const workingDir = opts?.workingDir ?? '/workspace';

    try {
      const result = await execa(
        'docker',
        ['exec', '-w', workingDir, ...envArgs, handle.containerId, 'sh', '-c', command],
        { timeout: opts?.timeoutMs ?? this.cfg.execTimeoutMs },
      );
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
      log.debug('sandbox.exec_nonzero', {
        containerId: handle.containerId.slice(0, 12),
        exitCode:    e.exitCode,
        command:     command.slice(0, 80),
      });
      return {
        stdout:   e.stdout   ?? '',
        stderr:   e.stderr   ?? e.message ?? String(err),
        exitCode: e.exitCode ?? 1,
      };
    }
  }

  async destroyContainer(handle: SandboxHandle): Promise<void> {
    await execa('docker', ['rm', '-f', handle.containerId]).catch(() => {});
    await this._unmountOverlayfs(handle.workingDir).catch(() => {});
    await fs.rm(path.dirname(handle.workingDir), { recursive: true, force: true }).catch(() => {});
    log.info('sandbox.destroyed', { containerId: handle.containerId.slice(0, 12) });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Creates an overlayfs mount for a single sandbox branch.
   *
   * Layout:
   *   /tmp/tacv/<branchId>/lower  → symlink to repoPath (read-only lower layer)
   *   /tmp/tacv/<branchId>/upper  → branch writes land here only
   *   /tmp/tacv/<branchId>/work   → overlayfs internal scratch (required by kernel)
   *   /tmp/tacv/<branchId>/merged → the merged view mounted into the container
   *
   * This means each branch sees the full repo but writes only to its own
   * private upper directory. No copying of the repo — O(1) branch cost.
   */
  private async _createOverlayfsMount(): Promise<string> {
    const branchId  = crypto.randomUUID();
    const base      = path.join(this.cfg.mountRoot, branchId);
    const upperDir  = path.join(base, 'upper');
    const workDir   = path.join(base, 'work');
    const mergedDir = path.join(base, 'merged');

    await fs.mkdir(upperDir,  { recursive: true });
    await fs.mkdir(workDir,   { recursive: true });
    await fs.mkdir(mergedDir, { recursive: true });

    // Try overlayfs (Linux only). Falls back to a plain copy on macOS or
    // in environments where the user lacks mount privileges.
    const overlayfsOpts = `lowerdir=${this.cfg.repoPath},upperdir=${upperDir},workdir=${workDir}`;
    try {
      await execa('mount', ['-t', 'overlay', 'overlay', '-o', overlayfsOpts, mergedDir]);
      log.info('sandbox.overlayfs_mounted', { branchId, merged: mergedDir });
    } catch (err) {
      log.warn('sandbox.overlayfs_unavailable_fallback', {
        branchId, reason: String(err).slice(0, 120),
        hint: 'Run the worker as root, or grant CAP_SYS_ADMIN, to enable overlayfs.',
      });
      // Plain copy fallback — still isolated, just slower for large repos
      await fs.cp(this.cfg.repoPath, mergedDir, { recursive: true });
      log.info('sandbox.plain_copy_fallback', { branchId, mergedDir });
    }

    return mergedDir;
  }

  private async _unmountOverlayfs(mergedDir: string): Promise<void> {
    try {
      await execa('umount', [mergedDir]);
      log.debug('sandbox.overlayfs_unmounted', { mergedDir });
    } catch {
      // Not mounted (plain copy fallback was used, or already unmounted)
    }
  }

  /**
   * Resolves the Docker runtime to use.
   * 'auto' probes for gVisor and falls back to runc without throwing.
   */
  private async _resolveRuntime(): Promise<string> {
    if (this.cfg.runtime !== 'auto') return this.cfg.runtime;
    try {
      await execa('runsc', ['--version']);
      return 'runsc';
    } catch {
      log.warn('sandbox.gvisor_not_found', { hint: 'Install gVisor to enable kernel-level isolation: https://gvisor.dev/docs/user_guide/install/' });
      return 'runc';
    }
  }

  private _buildRunArgs(
    workDir:   string,
    jdwpPort:  number,
    cdpPort:   number,
    runtime:   string,
  ): string[] {
    const seccompArgs = this._seccompArgs();

    return [
      'run', '-d', '--rm',

      // ── Isolation ─────────────────────────────────────────────────────────
      '--runtime',    runtime,            // gVisor or runc
      '--network',    'none',             // no egress from AI-generated code
      '--read-only',                      // immutable root filesystem

      // ── Filesystem ────────────────────────────────────────────────────────
      '--tmpfs',      '/tmp:rw,noexec,nosuid,size=256m',
      '-v',           `${workDir}:/workspace:rw`,   // overlayfs merged view

      // ── Resource limits ───────────────────────────────────────────────────
      '--memory',     String(this.cfg.memoryBytes),
      '--cpu-quota',  String(this.cfg.cpuQuota),
      '--cpu-period', String(this.cfg.cpuPeriod),
      '--pids-limit', String(this.cfg.pidsLimit),

      // ── Security ──────────────────────────────────────────────────────────
      '--security-opt', 'no-new-privileges:true',
      ...seccompArgs,

      // ── Debug ports ───────────────────────────────────────────────────────
      '-p', `${jdwpPort}:5005`,   // JDWP (Java debugger)
      '-p', `${cdpPort}:9229`,    // CDP  (Node.js / Chrome DevTools)

      this.cfg.image,
      'sleep', 'infinity',
    ];
  }

  private _seccompArgs(): string[] {
    // Only apply a custom seccomp profile if the file actually exists.
    // The built-in Docker default seccomp profile is applied automatically
    // when no --security-opt seccomp= flag is given.
    try {
      // Synchronous stat — acceptable here, called once per warmContainer()
      const stat = require('node:fs').statSync(this.cfg.seccompProfilePath);
      if (stat.isFile()) {
        return ['--security-opt', `seccomp=${this.cfg.seccompProfilePath}`];
      }
    } catch { /* file doesn't exist — use Docker default */ }
    return [];
  }

  private async _freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        srv.close(err => (err ? reject(err) : resolve(port)));
      });
      srv.once('error', reject);
    });
  }
}
