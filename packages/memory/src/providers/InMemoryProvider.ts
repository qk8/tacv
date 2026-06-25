import type { IMemoryProvider, MemoryItem, MemoryQuery } from '@tacv/core/interfaces';

export class InMemoryProvider implements IMemoryProvider {
  private readonly store = new Map<string, MemoryItem>();
  private counter = 0;

  async add(text: string, userId: string, agentId: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const id = `mem_${++this.counter}`;
    this.store.set(id, { id, text, metadata: { ...metadata, userId, agentId } });
    return id;
  }

  async search(query: MemoryQuery): Promise<MemoryItem[]> {
    const terms   = query.text.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const matches = [...this.store.values()]
      .filter(m => {
        const uid = m.metadata['userId'] as string | undefined;
        const aid = m.metadata['agentId'] as string | undefined;
        if (uid !== query.userId && uid !== 'global') return false;
        if (aid !== query.agentId) return false;
        if (query.filters) {
          for (const [k, v] of Object.entries(query.filters)) {
            if (m.metadata[k] !== v) return false;
          }
        }
        return terms.some(t => m.text.toLowerCase().includes(t));
      })
      .map(m => ({ ...m, score: terms.filter(t => m.text.toLowerCase().includes(t)).length / terms.length }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, query.topK ?? 10);
    return matches;
  }

  async getAll(userId: string, agentId: string): Promise<MemoryItem[]> {
    return [...this.store.values()].filter(m => m.metadata['userId'] === userId && m.metadata['agentId'] === agentId);
  }

  async delete(id: string): Promise<void> { this.store.delete(id); }
  async deleteAll(userId: string, agentId: string): Promise<void> {
    for (const [k, v] of this.store) { if (v.metadata['userId'] === userId && v.metadata['agentId'] === agentId) this.store.delete(k); }
  }
  get size(): number { return this.store.size; }
}
