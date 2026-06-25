import type { IMemoryProvider, MemoryItem, MemoryQuery } from '@tacv/core/interfaces';

export interface Mem0Config {
  apiKey:            string;
  vectorStore?:      string;
  vectorStoreConfig?: Record<string, unknown>;
  anthropicApiKey?:  string;
}

export class Mem0MemoryProvider implements IMemoryProvider {
  private mem0: unknown = null;

  constructor(private readonly config: Mem0Config) {}

  private async _init(): Promise<{ add: Function; search: Function; getAll: Function; delete: Function; deleteAll: Function }> {
    if (this.mem0) return this.mem0 as never;
    try {
      const { Memory } = await import('@mem0ai/mem0');
      this.mem0 = new Memory({
        vectorStore: { provider: this.config.vectorStore ?? 'qdrant', config: this.config.vectorStoreConfig ?? {} },
        llm: { provider: 'anthropic', config: { model: 'claude-haiku-4-5-20251001', apiKey: this.config.anthropicApiKey ?? this.config.apiKey } },
        embedder: { provider: 'anthropic', config: { model: 'voyage-3', apiKey: this.config.anthropicApiKey ?? this.config.apiKey } },
      });
    } catch { throw new Error('mem0ai package not installed. Run: npm install @mem0ai/mem0'); }
    return this.mem0 as never;
  }

  async add(text: string, userId: string, agentId: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const m = await this._init();
    const r = await m.add([{ role: 'user', content: text }], { userId, agentId, metadata }) as { results?: Array<{ id: string }> };
    return r.results?.[0]?.id ?? '';
  }

  async search(query: MemoryQuery): Promise<MemoryItem[]> {
    const m = await this._init();
    const r = await m.search(query.text, { userId: query.userId, agentId: query.agentId, limit: query.topK ?? 10, filters: query.filters }) as Array<Record<string, unknown>>;
    return r.map(i => ({ id: String(i['id']), text: String(i['memory'] ?? ''), metadata: (i['metadata'] as Record<string, unknown>) ?? {}, score: i['score'] as number | undefined }));
  }

  async getAll(userId: string, agentId: string): Promise<MemoryItem[]> {
    const m = await this._init();
    const r = await m.getAll({ userId, agentId }) as Array<Record<string, unknown>>;
    return r.map(i => ({ id: String(i['id']), text: String(i['memory'] ?? ''), metadata: (i['metadata'] as Record<string, unknown>) ?? {} }));
  }

  async delete(id: string): Promise<void> { const m = await this._init(); await m.delete(id); }
  async deleteAll(userId: string, agentId: string): Promise<void> { const m = await this._init(); await m.deleteAll({ userId, agentId }); }
}
