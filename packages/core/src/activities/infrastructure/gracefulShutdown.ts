import type { Worker } from '@temporalio/worker';

/**
 * Registers SIGTERM/SIGINT handlers that gracefully shut down the Temporal worker.
 *
 * The worker finishes in-flight tasks before exiting, ensuring durable execution
 * state is consistent. On second signal, forces immediate exit to prevent zombie processes.
 */
export function registerShutdown(worker: Worker): void {
  let shuttingDown = false;

  const handleSignal = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      console.error(`[tacv] Force exit on ${signal} (second signal)`);
      process.exit(1);
      return;
    }
    shuttingDown = true;

    console.log(`[tacv] ${signal} received. Shutting down worker...`);
    try {
      await worker.shutdown();
      console.log('[tacv] Worker shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error(`[tacv] Error during shutdown: ${err}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}
