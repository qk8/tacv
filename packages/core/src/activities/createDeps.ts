import type { ActivityDeps, LanguagePluginRegistry } from './ActivityDeps.js';
import type { WorkflowConfig } from '../config/index.js';

/**
 * Factory that wires all concrete providers into the ActivityDeps contract.
 * Called once at worker startup. Each activity is then a closure over these deps.
 *
 * Providers are injected via environment variables or explicit config so the
 * worker remains vendor-agnostic. Swap ClaudeAgentProvider for any IAgentProvider
 * without touching the workflows.
 */
export async function createDeps(config: WorkflowConfig): Promise<ActivityDeps> {
  const { createLogger } = await import('../observability/logger.js');
  const log = createLogger('tacv.worker');

  // Agent provider — Claude with optional Langfuse tracing
  let agent: ActivityDeps['agent'];
  try {
    const { ClaudeAgentProvider }   = await import('@tacv/provider-claude');
    const { LangfuseTracingAgent }  = await import('@tacv/provider-claude');
    const { BudgetAwareAgent }      = await import('./infrastructure/BudgetAwareAgent.js');

    const base = new ClaudeAgentProvider({
      apiKey:         process.env['ANTHROPIC_API_KEY'] ?? '',
      model:          config.agentModel,
      costPerMInput:  config.tokenBudget.costPerMInput,
      costPerMOutput: config.tokenBudget.costPerMOutput,
    });

    const traced = config.langfuse.enabled && config.langfuse.publicKey
      ? new LangfuseTracingAgent(base, `tacv-worker-${Date.now()}`, { publicKey: config.langfuse.publicKey, secretKey: config.langfuse.secretKey ?? '' })
      : base;

    agent = new BudgetAwareAgent(traced, config.tokenBudget);
  } catch {
    log.warn('createDeps.claude_unavailable_using_stub');
    const { StubAgentProvider } = await import('@tacv/stubs');
    agent = new StubAgentProvider();
  }

  // Structured extractor — Instructor + base Anthropic SDK
  let extractor: ActivityDeps['extractor'];
  try {
    const { ClaudeStructuredExtractor } = await import('@tacv/provider-claude');
    extractor = new ClaudeStructuredExtractor({ apiKey: process.env['ANTHROPIC_API_KEY'] ?? '', defaultModel: 'claude-haiku-4-5-20251001' });
  } catch {
    const { StubStructuredExtractor } = await import('@tacv/stubs');
    extractor = new StubStructuredExtractor({});
  }

  // Memory provider
  let memory: ActivityDeps['memory'];
  if (config.mem0VectorStore !== 'in-memory') {
    try {
      const { Mem0MemoryProvider } = await import('@tacv/provider-mem0');
      memory = new Mem0MemoryProvider({ apiKey: process.env['ANTHROPIC_API_KEY'] ?? '', vectorStore: config.mem0VectorStore, vectorStoreConfig: config.mem0Config as Record<string, unknown> });
    } catch {
      const { InMemoryProvider } = await import('@tacv/memory');
      memory = new InMemoryProvider();
    }
  } else {
    const { InMemoryProvider } = await import('@tacv/memory');
    memory = new InMemoryProvider();
  }

  // Sandbox provider
  let sandbox: ActivityDeps['sandbox'];
  try {
    const { DockerSandboxProvider } = await import('@tacv/provider-docker');
    sandbox = new DockerSandboxProvider({ repoPath: config.repoPath });
  } catch {
    const { StubSandboxProvider } = await import('@tacv/stubs');
    sandbox = new StubSandboxProvider();
  }

  // Code graph
  const { CodeGraphService } = await import('@tacv/code-graph');
  const codeGraph = new CodeGraphService();

  // Library docs
  let libraryDocs: ActivityDeps['libraryDocs'];
  if (config.libraryDocs.provider === 'context7') {
    try {
      const { Context7DocsProvider } = await import('@tacv/provider-context7');
      libraryDocs = new Context7DocsProvider();
    } catch {
      const { DisabledDocsProvider } = await import('@tacv/provider-context7');
      libraryDocs = new DisabledDocsProvider();
    }
  } else {
    const { DisabledDocsProvider } = await import('@tacv/provider-context7');
    libraryDocs = new DisabledDocsProvider();
  }

  // Language plugin registry
  const { LanguagePluginRegistry } = await import('@tacv/language-plugins-base');
  const pluginRegistry = new LanguagePluginRegistry();
  try {
    const { TypeScriptPlugin } = await import('@tacv/plugin-typescript');
    const { ReactProfile, FastifyProfile, VueProfile, ExpressProfile, NextJsProfile } = await import('@tacv/plugin-typescript');
    pluginRegistry.register(new TypeScriptPlugin([new ReactProfile(), new FastifyProfile(), new VueProfile(), new ExpressProfile(), new NextJsProfile()]));
  } catch (e) { log.warn('createDeps.ts_plugin_unavailable', { error: String(e) }); }
  try {
    const { JavaPlugin } = await import('@tacv/plugin-java');
    const { SpringBootProfile } = await import('@tacv/plugin-java');
    pluginRegistry.register(new JavaPlugin([new SpringBootProfile()]));
  } catch (e) { log.warn('createDeps.java_plugin_unavailable', { error: String(e) }); }

  return {
    config, agent, extractor, memory, sandbox,
    codeGraph: codeGraph as never, libraryDocs,
    pluginRegistry: pluginRegistry as unknown as LanguagePluginRegistry,
    log, repoPath: config.repoPath,
    taskId: '',     // overridden per-activity call
    sessionId: '',  // overridden per-activity call
  };
}
