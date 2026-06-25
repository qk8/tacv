import { Command } from 'commander';

export function makeRunCommand(): Command {
  const cmd = new Command('run');
  cmd
    .description('Start a new TACV coding workflow run')
    .requiredOption('--task-id <id>',    'Unique task identifier')
    .requiredOption('--description <d>', 'Task description')
    .option('--mode <m>',                'GREENFIELD or BROWNFIELD', 'BROWNFIELD')
    .option('--module <m>',              'Module type (e.g. java-backend)', 'java-backend')
    .option('--languages <l>',           'Comma-separated language IDs', 'java')
    .option('--config <path>',           'Path to tacv.json config file')
    .option('--repo <path>',             'Repository root path', '.')
    .option('--skip-tdd-gate',           'Skip TDD gate (not recommended)', false)
    .action(async (opts: {
      taskId:      string;
      description: string;
      mode:        string;
      module:      string;
      languages:   string;
      config?:     string;
      repo:        string;
      skipTddGate: boolean;
    }) => {
      const { initOtel, loadConfig } = await import('@tacv/core');
      initOtel();

      let raw = {};
      if (opts.config) {
        const { readFile } = await import('node:fs/promises');
        raw = JSON.parse(await readFile(opts.config, 'utf8')) as Record<string, unknown>;
      }
      const config = loadConfig({ ...raw, repoPath: opts.repo, skipTddGate: opts.skipTddGate });

      const { Client }     = await import('@temporalio/client');
      const { workflowStateQuery } = await import('@tacv/core');
      const { ProgressRenderer }   = await import('../progress/ProgressRenderer.js');
      const { TaskSpec }           = await import('@tacv/core');

      const client = new Client({ connection: { address: config.temporalAddress } });

      const task = TaskSpec.parse({
        taskId:      opts.taskId,
        description: opts.description,
        mode:        opts.mode,
        moduleType:  opts.module,
        languageIds: opts.languages.split(',').map((s: string) => s.trim()),
      });

      console.log(`[tacv] Starting: ${task.taskId} | Mode: ${task.mode} | Module: ${task.moduleType}`);
      console.log(`[tacv] Temporal: http://localhost:8233/namespaces/default/workflows/${task.taskId}`);

      const handle = await client.workflow.start('CodingWorkflow', {
        args:       [task],
        taskQueue:  config.taskQueue,
        workflowId: task.taskId,
      });

      const renderer = new ProgressRenderer();
      await renderer.render(handle, workflowStateQuery);

      const lesson = await handle.result();
      if (lesson) {
        console.log(`\n[tacv] ✅ Done! Cost=$${(lesson as { totalCostUsd: number }).totalCostUsd.toFixed(4)} attempts=${(lesson as { correctionAttempts: number }).correctionAttempts}`);
      } else {
        console.error('\n[tacv] ❌ Workflow failed or was aborted');
        process.exitCode = 1;
      }
    });

  return cmd;
}
