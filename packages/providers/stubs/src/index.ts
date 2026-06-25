import type { IAgentProvider, AgentResult, AgentConfig } from '../../core/src/interfaces/IAgentProvider.js';
import type { IStructuredExtractor, ExtractOptions } from '../../core/src/interfaces/IStructuredExtractor.js';
import type { IMemoryProvider, MemoryItem, MemoryQuery } from '../../core/src/interfaces/IMemoryProvider.js';
import type { ISandboxProvider, SandboxHandle, ExecResult, ExecOptions } from '../../core/src/interfaces/ISandboxProvider.js';
import type { ILibraryDocsProvider, ResolvedDocs, DetectedDependency } from '../../core/src/interfaces/ILibraryDocsProvider.js';
import type { z } from 'zod';

export class StubAgentProvider implements IAgentProvider {
  constructor(public response = '{"diffs":[],"summary":"stub","testFilePaths":[]}') {}
  async runTask(_prompt: string, _ctx: Record<string, unknown>, _cfg: AgentConfig, _spend: number): Promise<AgentResult> {
    return { content: this.response, toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001, callCostUsd: 0.001 };
  }
}

export class StubStructuredExtractor implements IStructuredExtractor {
  constructor(private readonly defaults: Record<string, unknown> = {}) {}
  async extract<T extends z.ZodType>(_prompt: string, schema: T, _opts: ExtractOptions): Promise<z.infer<T>> {
    try { return schema.parse(this.defaults); } catch { return schema.parse({}); }
  }
}

export class StubMemoryProvider implements IMemoryProvider {
  private readonly store = new Map<string, MemoryItem & { userId: string; agentId: string }>();
  private counter = 0;
  async add(text: string, userId: string, agentId: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const id = `mem_${++this.counter}`;
    this.store.set(id, { id, text, metadata, userId, agentId });
    return id;
  }
  async search(query: MemoryQuery): Promise<MemoryItem[]> {
    const terms = query.text.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    return [...this.store.values()]
      .filter(m => {
        if (m.userId !== query.userId && m.userId !== 'global') return false;
        if (m.agentId !== query.agentId) return false;
        if (query.filters) for (const [k, v] of Object.entries(query.filters)) if (m.metadata[k] !== v) return false;
        return terms.some(t => m.text.toLowerCase().includes(t));
      })
      .slice(0, query.topK ?? 10);
  }
  async getAll(userId: string, agentId: string): Promise<MemoryItem[]> {
    return [...this.store.values()].filter(m => m.userId === userId && m.agentId === agentId);
  }
  async delete(id: string): Promise<void> { this.store.delete(id); }
  async deleteAll(userId: string, agentId: string): Promise<void> {
    for (const [k, v] of this.store) if (v.userId === userId && v.agentId === agentId) this.store.delete(k);
  }
}

export class StubSandboxProvider implements ISandboxProvider {
  public execResponses: ExecResult[] = [];
  private idx = 0;
  async warmContainer(): Promise<SandboxHandle> { return { containerId: 'stub-ctr-1', workingDir: '/tmp/stub', hostJdwpPort: 5005, hostCdpPort: 9229 }; }
  async execInContainer(_h: SandboxHandle, _cmd: string, _opts?: ExecOptions): Promise<ExecResult> {
    return this.execResponses[this.idx++] ?? { stdout: '', stderr: '', exitCode: 0 };
  }
  async destroyContainer(_h: SandboxHandle): Promise<void> {}
  async validateImage(): Promise<void> {}
}

export class StubLibraryDocsProvider implements ILibraryDocsProvider {
  isEnabled(): boolean { return false; }
  async resolve(_deps: DetectedDependency[]): Promise<ResolvedDocs> { return { libraries: [], tokenEstimate: 0 }; }
}
