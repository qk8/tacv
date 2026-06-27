import { describe, it, expect } from 'vitest';
import { StackTraceParser } from '../src/StackTraceParser.js';
import type { IStackParser } from '@tacv/language-plugins-base';
import type { StackFrame } from '@tacv/contracts';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeParser(frames: StackFrame[]): IStackParser {
  return { parseAndPrune: () => frames };
}

describe('StackTraceParser — plugin-delegated coordinator', () => {
  it('delegates to the plugin-provided IStackParser', () => {
    const pluginParser = makeParser([
      { file: 'UserService.java', line: 45, method: 'com.example.UserService.findById', isUser: true },
    ]);
    const coordinator = new StackTraceParser(pluginParser);
    const frames = coordinator.parseAndPrune('any raw output', 'backend');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.file).toBe('UserService.java');
  });

  it('returns empty array when plugin parser finds no frames', () => {
    const coordinator = new StackTraceParser(makeParser([]));
    expect(coordinator.parseAndPrune('BUILD SUCCESS', 'backend')).toHaveLength(0);
  });

  it('preserves all frame fields from plugin parser', () => {
    const frame: StackFrame = { file: 'Foo.ts', line: 10, method: 'bar', isUser: true };
    const coordinator = new StackTraceParser(makeParser([frame]));
    const result = coordinator.parseAndPrune('', 'backend')[0];
    expect(result?.file).toBe('Foo.ts');
    expect(result?.line).toBe(10);
    expect(result?.method).toBe('bar');
    expect(result?.isUser).toBe(true);
  });

  it('limits results to 10 frames', () => {
    const manyFrames: StackFrame[] = Array.from({ length: 20 }, (_, i) => ({
      file: `File${i}.ts`, line: i, method: `method${i}`, isUser: true,
    }));
    const coordinator = new StackTraceParser(makeParser(manyFrames));
    expect(coordinator.parseAndPrune('', 'backend')).toHaveLength(10);
  });
});
