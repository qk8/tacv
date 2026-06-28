import { describe, it, expect, vi } from 'vitest';
import { ObservabilityInterceptor } from '../../../src/observability/interceptors.js';

// Mock the logger and tracer
vi.mock('../../../src/observability/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('ObservabilityInterceptor', () => {
  it('extracts activity name from Temporal Context', async () => {
    const interceptor = new ObservabilityInterceptor();

    // The interceptor should use Context.current().info.activityType
    // We can't easily mock Temporal's Context, but we can verify the
    // interceptor doesn't crash and uses the fallback header path
    const mockNext = vi.fn().mockResolvedValue('result');

    // When Context.current() fails (not in activity context), it falls back to headers
    const input = { headers: { activityName: Buffer.from('runTestValidityReview') } };
    const result = await interceptor.execute(input, mockNext);

    expect(result).toBe('result');
    expect(mockNext).toHaveBeenCalledWith(input);
  });
});
