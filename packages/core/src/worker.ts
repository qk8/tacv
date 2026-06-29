import { Worker, NativeConnection, Runtime } from '@temporalio/worker';
import { activityContext } from '@temporalio/activity';
import { initOtel }                from './observability/otel.js';
import { ObservabilityInterceptor } from './observability/interceptors.js';
import { loadConfig }              from './config/index.js';
import { createDeps }              from './activities/createDeps.js';
import { registerActivities }      from './activities/registerActivities.js';

async function run(): Promise<void> {
  initOtel();
  Runtime.install({ logger: { level: 'INFO', scope: 'INFO', forward: true } });

  const config = loadConfig(process.env['TACV_CONFIG']);

  console.log('[tacv] Initialising provider dependencies...');
  const deps = await createDeps(config);
  console.log('[tacv] Providers ready. Connecting to Temporal...');

  const connection = await NativeConnection.connect({ address: config.temporalAddress });

  // Activities are closures over deps — NOT registered as raw module exports
  const activities = registerActivities(deps);

  const worker = await Worker.create({
    connection,
    namespace:     config.temporalNamespace,
    taskQueue:     config.taskQueue,
    workflowsPath: new URL('./workflows/index.js', import.meta.url).pathname,
    activities,
    interceptors: {
      activityInbound: [() => new ObservabilityInterceptor(), {
        // Inject Temporal heartbeat into deps for activities that need it
        aroundStart: ({ start }) => async (input) => {
          // Attach heartbeat to deps for this activity invocation
          const origHeartbeat = deps.heartbeat;
          deps.heartbeat = (data?: unknown) => {
            try { activityContext().heartbeat(data); } catch { /* already gone */ }
          };
          const result = await start(input);
          deps.heartbeat = origHeartbeat;
          return result;
        },
      }],
    },
    maxConcurrentActivityTaskExecutions: config.maxParallelCritics + 4,
  });

  console.log(`[tacv] Worker running on queue: ${config.taskQueue}`);
  await worker.run();
}

run().catch((err) => {
  console.error('[tacv] Worker startup failed:', err);
  process.exit(1);
});
