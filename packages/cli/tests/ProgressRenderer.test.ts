import { describe, it, expect, vi } from 'vitest';
import { ProgressRenderer } from '../src/progress/ProgressRenderer.js';

describe('ProgressRenderer', () => {
  it('calls handle.query and handle.result', async () => {
    const mockState = { currentPhase: 'ACTOR', correctionCycle: { attemptCount: 1 }, cumulativeCostUsd: 0.5, confidenceScore: 0.8 };
    const handle = {
      query:  vi.fn().mockResolvedValue(mockState),
      result: vi.fn().mockResolvedValue(null),
    };

    const renderer = new ProgressRenderer();
    const writeStub = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderer.render(handle as never);

    expect(handle.result).toHaveBeenCalled();
    writeStub.mockRestore();
  });
});
