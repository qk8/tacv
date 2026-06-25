import { describe, it, expect } from 'vitest';
import { StubAgentProvider, StubStructuredExtractor, StubMemoryProvider, StubSandboxProvider, StubLibraryDocsProvider } from '../src/index.js';
import { z } from 'zod';

describe('StubAgentProvider', () => {
  it('returns configured response', async () => {
    const p = new StubAgentProvider('Hello from agent');
    const r = await p.runTask('prompt', {}, { role: 'test', systemPrompt: '', maxTurns: 1, allowedTools: [] }, 0);
    expect(r.content).toBe('Hello from agent');
    expect(r.callCostUsd).toBeGreaterThan(0);
    expect(r.finishReason).toBe('end_turn');
  });
  it('returns default JSON diff response', async () => {
    const p = new StubAgentProvider();
    const r = await p.runTask('prompt', {}, { role: 'actor', systemPrompt: '', maxTurns: 1, allowedTools: [] }, 0);
    expect(r.content).toContain('diffs');
  });
});

describe('StubStructuredExtractor', () => {
  it('extracts with provided defaults', async () => {
    const schema = z.object({ name: z.string().default('x'), value: z.number().default(0) });
    const ex = new StubStructuredExtractor({ name: 'test', value: 99 });
    const result = await ex.extract('prompt', schema, {});
    expect(result.name).toBe('test');
    expect(result.value).toBe(99);
  });
  it('falls back to schema defaults on bad input', async () => {
    const schema = z.object({ count: z.number().default(5) });
    const ex = new StubStructuredExtractor({ count: 'not-a-number' });
    const result = await ex.extract('prompt', schema, {});
    expect(result.count).toBe(5);
  });
});

describe('StubMemoryProvider', () => {
  it('stores and retrieves by userId+agentId', async () => {
    const p = new StubMemoryProvider();
    await p.add('Spring Boot best practices', 'user1', 'agent1', { type: 'lesson' });
    const items = await p.getAll('user1', 'agent1');
    expect(items).toHaveLength(1);
  });
  it('search finds by keyword', async () => {
    const p = new StubMemoryProvider();
    await p.add('TypeScript strict mode helps catch bugs', 'u', 'a');
    await p.add('Java streams are powerful', 'u', 'a');
    const results = await p.search({ userId: 'u', agentId: 'a', text: 'TypeScript strict', topK: 5 });
    expect(results.some(r => r.text.includes('TypeScript'))).toBe(true);
  });
  it('delete removes item', async () => {
    const p = new StubMemoryProvider();
    const id = await p.add('to delete', 'u', 'a');
    await p.delete(id);
    expect(await p.getAll('u', 'a')).toHaveLength(0);
  });
  it('deleteAll scoped to user+agent', async () => {
    const p = new StubMemoryProvider();
    await p.add('keep', 'u2', 'a');
    await p.add('delete', 'u1', 'a');
    await p.deleteAll('u1', 'a');
    expect(await p.getAll('u2', 'a')).toHaveLength(1);
    expect(await p.getAll('u1', 'a')).toHaveLength(0);
  });
});

describe('StubSandboxProvider', () => {
  it('returns a valid handle', async () => {
    const handle = await new StubSandboxProvider().warmContainer();
    expect(handle.containerId).toBeTruthy();
    expect(handle.hostJdwpPort).toBe(5005);
  });
  it('returns exec responses in order', async () => {
    const p = new StubSandboxProvider();
    p.execResponses = [{ stdout: 'BUILD SUCCESS', stderr: '', exitCode: 0 }, { stdout: 'Tests passed', stderr: '', exitCode: 0 }];
    const h = await p.warmContainer();
    expect((await p.execInContainer(h, 'build')).stdout).toBe('BUILD SUCCESS');
    expect((await p.execInContainer(h, 'test')).stdout).toBe('Tests passed');
  });
  it('returns empty result after responses exhausted', async () => {
    const p = new StubSandboxProvider();
    const h = await p.warmContainer();
    const r = await p.execInContainer(h, 'any');
    expect(r.exitCode).toBe(0);
  });
});

describe('StubLibraryDocsProvider', () => {
  it('is disabled', () => { expect(new StubLibraryDocsProvider().isEnabled()).toBe(false); });
  it('returns empty docs', async () => {
    const r = await new StubLibraryDocsProvider().resolve([]);
    expect(r.libraries).toHaveLength(0);
  });
});
