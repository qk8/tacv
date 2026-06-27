import type { DebugAdapterSpec } from '@tacv/language-plugins-base';
import type { IDebugAdapter } from '@tacv/contracts';
import { CdpDebugAdapter }  from './adapters/CdpDebugAdapter.js';
import { JdwpDebugAdapter } from './adapters/JdwpDebugAdapter.js';
import { DapDebugAdapter }  from './adapters/DapDebugAdapter.js';

/**
 * Creates a concrete IDebugAdapter from a declarative DebugAdapterSpec.
 *
 * Plugins describe *what* they need (protocol, port, launch template) via
 * `getDebugAdapterSpec()`. This factory is the only place that knows *which*
 * concrete adapter class to instantiate for each protocol — keeping that
 * coupling out of both the plugin system and the workflow activities.
 *
 * @returns The adapter, or `null` for `protocol: 'none'`.
 */
export function createDebugAdapter(spec: DebugAdapterSpec): IDebugAdapter | null {
  switch (spec.protocol) {
    case 'cdp':  return new CdpDebugAdapter();
    case 'jdwp': return new JdwpDebugAdapter();
    case 'dap':  return new DapDebugAdapter();
    case 'none': return null;
  }
}

/**
 * Builds the launch command by substituting `${port}` in the template.
 */
export function buildLaunchCmd(spec: DebugAdapterSpec, portOverride?: number): string {
  const port = portOverride ?? spec.defaultPort;
  return spec.launchCmdTemplate.replace(/\$\{port\}/g, String(port));
}
