import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProvider } from '../src/providers/InMemoryProvider.js';

describe('InMemoryProvider', () => {
  let provider: InMemoryProvider;
  beforeEach(() => { provider = new InMemoryProvider(); });

  it('adds and retrieves items', async () => {
    await provider.add('TypeScript is a typed superset of JavaScript', 'user1', 'agent1', { type: 'fact' });
    const items = await provider.getAll('user1', 'agent1');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('TypeScript');
  });

  it('searches by keyword', async () => {
    await provider.add('Spring Boot auto-configuration guide', 'g', 'agent', { type: 'lesson' });
    await provider.add('Vitest is fast and modern', 'g', 'agent', { type: 'fact' });
    const results = await provider.search({ userId: 'g', agentId: 'agent', text: 'Spring Boot', topK: 5 });
    expect(results.some(r => r.text.includes('Spring'))).toBe(true);
  });

  it('filters by metadata', async () => {
    await provider.add('lesson text', 'g', 'a', { type: 'lesson' });
    await provider.add('fact text', 'g', 'a', { type: 'fact' });
    const results = await provider.search({ userId: 'g', agentId: 'a', text: 'text', filters: { type: 'lesson' } });
    expect(results.every(r => r.metadata['type'] === 'lesson')).toBe(true);
  });

  it('deletes items by id', async () => {
    const id = await provider.add('to delete', 'u', 'a');
    await provider.delete(id);
    expect(await provider.getAll('u', 'a')).toHaveLength(0);
  });

  it('deleteAll removes only matching user+agent', async () => {
    await provider.add('item1', 'u1', 'a1');
    await provider.add('item2', 'u2', 'a1');
    await provider.deleteAll('u1', 'a1');
    expect(await provider.getAll('u1', 'a1')).toHaveLength(0);
    expect(await provider.getAll('u2', 'a1')).toHaveLength(1);
  });

  it('respects topK limit', async () => {
    for (let i = 0; i < 10; i++) await provider.add(`item ${i} relevant`, 'u', 'a');
    const results = await provider.search({ userId: 'u', agentId: 'a', text: 'item relevant', topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
