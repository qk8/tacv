import { execa }  from 'execa';
import * as fs    from 'node:fs/promises';
import * as net   from 'node:net';
import * as crypto from 'node:crypto';
import type { ISandboxProvider, SandboxHandle, ExecResult, ExecOptions } from '@tacv/core/interfaces';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.firecracker');

/**
 * Firecracker microVM sandbox provider.
 * Provides stronger isolation than Docker + gVisor for untrusted generated code.
 * Requires:
 *   - firecracker binary in PATH
 *   - A rootfs image at /opt/tacv/sandbox.ext4
 *   - A kernel image at /opt/tacv/vmlinux
 *   - KVM available (/dev/kvm)
 *
 * Fallback: if Firecracker is not available, logs a warning and returns
 * an error. Use DockerSandboxProvider for development environments.
 */
export class FirecrackerSandboxProvider implements ISandboxProvider {
  private readonly vms = new Map<string, { socketPath: string; workDir: string; pid?: number }>();

  constructor(private readonly config: {
    kernelImagePath?: string;
    rootfsPath?:      string;
    vcpuCount?:       number;
    memSizeMib?:      number;
    repoPath:         string;
  }) {}

  async validateImage(): Promise<void> {
    try {
      await execa('firecracker', ['--version']);
      await fs.access(this.config.kernelImagePath ?? '/opt/tacv/vmlinux');
      await fs.access(this.config.rootfsPath      ?? '/opt/tacv/sandbox.ext4');
    } catch (err) {
      throw new Error(`Firecracker not available: ${String(err)}. Use DockerSandboxProvider for development.`);
    }
  }

  async warmContainer(): Promise<SandboxHandle> {
    const vmId      = crypto.randomUUID().slice(0, 8);
    const socketPath = `/tmp/tacv-fc-${vmId}.socket`;
    const workDir   = `/tmp/tacv-fc-work-${vmId}`;

    await fs.mkdir(workDir, { recursive: true });
    await fs.cp(this.config.repoPath, workDir + '/workspace', { recursive: true }).catch(() => {});

    // Start Firecracker VM
    const fcProc = execa('firecracker', ['--api-sock', socketPath], {
      detached: true, stdio: 'ignore',
    });
    fcProc.unref();

    // Wait for socket to appear
    await this._waitForSocket(socketPath, 10_000);

    // Configure the VM via Firecracker API
    const fcApi = async (path: string, body: unknown) => {
      const res = await fetch(`http://localhost/v1/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // @ts-expect-error — Node 18+ fetch doesn't have Unix socket support natively
        // Use firecracker's own HTTP socket
        dispatcher: new (await import('undici').then(m => m.Agent))({ connect: { socketPath } }),
      });
      if (!res.ok) throw new Error(`Firecracker API error: ${res.status} ${await res.text()}`);
    };

    await fcApi('boot-source', { kernel_image_path: this.config.kernelImagePath ?? '/opt/tacv/vmlinux', boot_args: 'console=ttyS0 reboot=k panic=1 pci=off' });
    await fcApi('drives/rootfs', { drive_id: 'rootfs', path_on_host: this.config.rootfsPath ?? '/opt/tacv/sandbox.ext4', is_root_device: true, is_read_only: false });
    await fcApi('machine-config', { vcpu_count: this.config.vcpuCount ?? 1, mem_size_mib: this.config.memSizeMib ?? 512 });
    await fcApi('actions', { action_type: 'InstanceStart' });

    const jdwpPort = await this._freePort();
    const cdpPort  = await this._freePort();

    this.vms.set(vmId, { socketPath, workDir });
    log.info('firecracker.vm_started', { vmId });

    return { containerId: vmId, workingDir: workDir + '/workspace', hostJdwpPort: jdwpPort, hostCdpPort: cdpPort };
  }

  async execInContainer(handle: SandboxHandle, command: string, opts?: ExecOptions): Promise<ExecResult> {
    // Execute via SSH into the VM (Firecracker VMs expose SSH on port 22)
    try {
      const result = await execa('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=5',
        '-i', '/opt/tacv/vm-key',
        `root@${handle.containerId}`,
        `cd /workspace && ${command}`,
      ], { timeout: opts?.timeoutMs ?? 120_000 });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; exitCode?: number };
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err), exitCode: e.exitCode ?? 1 };
    }
  }

  async destroyContainer(handle: SandboxHandle): Promise<void> {
    const vm = this.vms.get(handle.containerId);
    if (!vm) return;
    try {
      await execa('firecracker', ['--api-sock', vm.socketPath, '--stop']).catch(() => {});
      await fs.rm(vm.workDir,   { recursive: true, force: true });
      await fs.rm(vm.socketPath, { force: true });
    } catch { /* best effort */ }
    this.vms.delete(handle.containerId);
    log.info('firecracker.vm_stopped', { vmId: handle.containerId });
  }

  private async _waitForSocket(socketPath: string, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      try { await fs.access(socketPath); return; } catch { await new Promise(r => setTimeout(r, 200)); }
    }
    throw new Error(`Firecracker socket not ready: ${socketPath}`);
  }

  private async _freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(e => e ? reject(e) : resolve(port));
      });
    });
  }
}
