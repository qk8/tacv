#!/usr/bin/env node
import { program } from 'commander';
import { initOtel } from '@tacv/core/observability';
import { loadConfig } from '@tacv/core/config';

program
  .name('tacv')
  .description('TypeScript Agentic Coding Workflow')
  .version('1.0.0');

program
  .command('run')
  .description('Start a new coding workflow run')
  .requiredOption('--task-id <id>',    'Unique task identifier')
  .requiredOption('--description <d>', 'Task description')
  .option('--mode <m>',     'GREENFIELD or BROWNFIELD', 'BROWNFIELD')
  .option('--module <m>',   'Module type (e.g. java-backend, ts-frontend)', 'generic')
  .option('--languages <l>','Comma-separated language IDs (e.g. java,typescript)', 'typescript')
  .option('--config <path>','Path to tacv.json config file')
  .option('--repo <path>',  'Repository path', '.')
  .action(async (opts: { taskId: string; description: string; mode: string; module: string; languages: string; config?: string; repo: string }) => {
    initOtel();
    const { TaskSpec } = await import('@tacv/core/state');
    const { Client } = await import('@temporalio/client');
    const { ProgressRenderer } = await import('./progress/ProgressRenderer.js');

    const config = loadConfig(opts.config);
    config.repoPath = opts.repo;

    const task = TaskSpec.parse({
      taskId: opts.taskId, description: opts.description,
      mode: opts.mode, moduleType: opts.module,
      languageIds: opts.languages.split(',').map((s: string) => s.trim()),
    });

    const client = new Client({ connection: { address: config.temporalAddress } });
    const renderer = new ProgressRenderer();

    console.log(`[tacv] Starting: ${task.taskId} (${task.mode} / ${task.moduleType})`);
    console.log(`[tacv] Temporal: http://localhost:8233/namespaces/${config.temporalNamespace}/workflows/${task.taskId}`);

    const handle = await client.workflow.start('CodingWorkflow', {
      args: [task, config], taskQueue: config.taskQueue, workflowId: task.taskId,
    });

    await renderer.render(handle);
    const lesson = await handle.result() as import('@tacv/core/state').LessonLearned | null;

    if (lesson) {
      console.log(`\n[tacv] ✅ Done! Cost: $${lesson.totalCostUsd.toFixed(4)} | Attempts: ${lesson.correctionAttempts} | Via: ${lesson.succeededVia}`);
    } else {
      console.error('\n[tacv] ⚠️  Workflow ended without completing.');
      process.exitCode = 1;
    }
  });

program
  .command('resume')
  .description('Resume a workflow waiting at a HITL gate')
  .requiredOption('--workflow-id <id>', 'Workflow ID to resume')
  .requiredOption('--action <a>',       'approve | reject | override')
  .option('--guidance <text>',          'Human guidance for the agent (use with override)')
  .option('--config <path>',            'Path to tacv.json')
  .action(async (opts: { workflowId: string; action: string; guidance?: string; config?: string }) => {
    const { Client } = await import('@temporalio/client');
    const config = loadConfig(opts.config);
    const client = new Client({ connection: { address: config.temporalAddress } });
    await client.workflow.getHandle(opts.workflowId).signal('human.resume', { action: opts.action, guidance: opts.guidance ?? '' });
    console.log(`[tacv] ✅ Resume signal sent to ${opts.workflowId}`);
  });

program
  .command('abort')
  .description('Abort a running workflow')
  .requiredOption('--workflow-id <id>', 'Workflow ID to abort')
  .option('--reason <r>',               'Reason for aborting', 'manual abort')
  .option('--config <path>',            'Path to tacv.json')
  .action(async (opts: { workflowId: string; reason: string; config?: string }) => {
    const { Client } = await import('@temporalio/client');
    const config = loadConfig(opts.config);
    const client = new Client({ connection: { address: config.temporalAddress } });
    await client.workflow.getHandle(opts.workflowId).signal('human.abort', { reason: opts.reason });
    console.log(`[tacv] Abort signal sent to ${opts.workflowId}`);
  });

program
  .command('status')
  .description('Query current state of a running workflow')
  .requiredOption('--workflow-id <id>', 'Workflow ID to query')
  .option('--config <path>',            'Path to tacv.json')
  .action(async (opts: { workflowId: string; config?: string }) => {
    const { Client } = await import('@temporalio/client');
    const config = loadConfig(opts.config);
    const client = new Client({ connection: { address: config.temporalAddress } });
    const state = await client.workflow.getHandle(opts.workflowId).query('workflow.state') as import('@tacv/core/state').WorkflowState;
    console.log(JSON.stringify({ phase: state.currentPhase, attempt: state.correctionCycle.attemptCount, costUsd: state.cumulativeCostUsd, confidence: state.confidenceScore }, null, 2));
  });

program.parse(process.argv);
