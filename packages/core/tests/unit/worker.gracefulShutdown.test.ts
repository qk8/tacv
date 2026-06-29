import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerShutdown } from '../../src/activities/infrastructure/gracefulShutdown.js';

describe('Worker graceful shutdown', () => {
  let originalOn: typeof process.on;
  let originalExit: typeof process.exit;
  let sigtermHandlers: Array<() => void>;
  let sigintHandlers: Array<() => void>;
  let exitCode: number | null;

  beforeEach(() => {
    vi.resetAllMocks();
    sigtermHandlers = [];
    sigintHandlers = [];
    exitCode = null;
    originalOn = process.on;
    originalExit = process.exit;

    // Intercept process.on to capture handlers
    process.on = ((event: string, handler: () => void) => {
      if (event === 'SIGTERM') sigtermHandlers.push(handler);
      if (event === 'SIGINT') sigintHandlers.push(handler);
      return originalOn.call(process, event, handler);
    }) as typeof process.on;

    // Mock process.exit to avoid Vitest errors
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.on = originalOn;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  it('registers SIGTERM and SIGINT handlers', () => {
    const mockWorker = {
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    registerShutdown(mockWorker);

    expect(sigtermHandlers.length).toBeGreaterThan(0);
    expect(sigintHandlers.length).toBeGreaterThan(0);
  });

  it('calls worker.shutdown when signal received', async () => {
    const mockWorker = {
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    registerShutdown(mockWorker);

    // Trigger SIGTERM
    sigtermHandlers[0]();

    // Give async shutdown time to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(mockWorker.shutdown).toHaveBeenCalled();
  });

  it('calls process.exit(0) after successful shutdown', async () => {
    const mockWorker = {
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    registerShutdown(mockWorker);

    sigtermHandlers[0]();
    await new Promise((r) => setTimeout(r, 50));

    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('calls process.exit(1) on shutdown error', async () => {
    const mockWorker = {
      shutdown: vi.fn().mockRejectedValue(new Error('shutdown failed')),
    };
    registerShutdown(mockWorker);

    sigtermHandlers[0]();
    await new Promise((r) => setTimeout(r, 50));

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
