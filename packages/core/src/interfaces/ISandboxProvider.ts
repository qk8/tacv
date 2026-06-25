export interface SandboxHandle {
  readonly containerId:  string;
  readonly workingDir:   string;
  readonly hostJdwpPort: number;
  readonly hostCdpPort:  number;
}

export interface ExecOptions {
  timeoutMs?:   number;
  env?:         Record<string, string>;
  workingDir?:  string;
}

export interface ExecResult {
  readonly stdout:   string;
  readonly stderr:   string;
  readonly exitCode: number;
}

export interface ISandboxProvider {
  warmContainer(): Promise<SandboxHandle>;
  execInContainer(handle: SandboxHandle, command: string, opts?: ExecOptions): Promise<ExecResult>;
  destroyContainer(handle: SandboxHandle): Promise<void>;
  validateImage(): Promise<void>;
}
