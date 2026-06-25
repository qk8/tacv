import { Command } from 'commander';

export function makeResumeCommand(): Command {
  const cmd = new Command('resume');
  cmd
    .description('Resume a workflow waiting for human review (HITL)')
    .requiredOption('--workflow-id <id>', 'Workflow ID to resume')
    .requiredOption('--action <action>',  'approve | reject | override')
    .option('--guidance <text>',          'Human guidance for the agent (required for override)')
    .option('--config <path>',            'Path to tacv.json config file')
    .action(async (opts: { workflowId: string; action: string; guidance?: string; config?: string }) => {
      const { loadConfig } = await import('@tacv/core');
      let raw = {};
      if (opts.config) {
        const { readFile } = await import('node:fs/promises');
        raw = JSON.parse(await readFile(opts.config, 'utf8')) as Record<string, unknown>;
      }
      const config = loadConfig(raw);

      if (opts.action === 'override' && !opts.guidance) {
        console.error('[tacv] Error: --guidance is required for override action');
        process.exitCode = 1;
        return;
      }

      const { Client } = await import('@temporalio/client');
      const client = new Client({ connection: { address: config.temporalAddress } });
      const handle = client.workflow.getHandle(opts.workflowId);

      await handle.signal('human.resume', {
        action:   opts.action,
        guidance: opts.guidance ?? '',
      });

      console.log(`[tacv] ✅ Resume signal sent to ${opts.workflowId} (action=${opts.action})`);
    });

  return cmd;
}
