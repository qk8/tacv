import type { BreakpointHit } from '../state/index.js';

export interface BreakpointLocation {
  file: string;
  line: number;
}

export interface VariableInfo {
  value: unknown;
  type:  string;
}

export interface DebugLaunchConfig {
  type:      string;
  launchCmd: string;
  cwd:       string;
  debugPort: number;
}

export interface IDebugAdapter {
  readonly name: string;
  connect(host: string, port: number): Promise<void>;
  disconnect(): Promise<void>;
  setBreakpoint(location: BreakpointLocation): Promise<void>;
  setConditionalBreakpoint(location: BreakpointLocation, condition: string): Promise<void>;
  resume(): Promise<void>;
  stepOver(): Promise<BreakpointHit | null>;
  stepInto(): Promise<BreakpointHit | null>;
  waitForBreakpointHit(timeoutMs: number): Promise<BreakpointHit | null>;
  getScopeVariables(): Promise<Record<string, VariableInfo>>;
  evaluate(expression: string): Promise<unknown>;
  getCallStack(): Promise<string[]>;
}
