import type { IAgentProvider, AgentConfig, AgentResult } from '@tacv/core/interfaces';

// Langfuse import is optional — fails gracefully if not installed
let Langfuse: new (cfg: Record<string, unknown>) => { trace: (o: Record<string, unknown>) => { generation: (o: Record<string, unknown>) => { end: (o: Record<string, unknown>) => void } }; flushAsync: () => Promise<void> } | null = null;
try {
  const mod = await import('langfuse').catch(() => null);
  if (mod) Langfuse = mod.default ?? mod.Langfuse;
} catch { /* langfuse not installed */ }

export class LangfuseTracingAgent implements IAgentProvider {
  private readonly lf: InstanceType<typeof Langfuse> | null = null;

  constructor(
    private readonly inner: IAgentProvider,
    private readonly sessionId: string,
    config?: { publicKey?: string; secretKey?: string; baseUrl?: string },
  ) {
    if (Langfuse && config?.publicKey && config?.secretKey) {
      this.lf = new Langfuse({ publicKey: config.publicKey, secretKey: config.secretKey, baseUrl: config.baseUrl });
    }
  }

  async runTask(prompt: string, context: Record<string, unknown>, config: AgentConfig, currentSpend: number): Promise<AgentResult> {
    if (!this.lf) return this.inner.runTask(prompt, context, config, currentSpend);

    const trace = this.lf.trace({ sessionId: this.sessionId, name: config.role });
    const generation = trace.generation({ name: config.role, model: context['model'] as string ?? 'claude', input: prompt, version: config.promptVersion });
    const result = await this.inner.runTask(prompt, context, config, currentSpend);
    generation.end({ output: result.content, usage: { input: result.inputTokens, output: result.outputTokens } });
    await this.lf.flushAsync();
    return result;
  }
}
