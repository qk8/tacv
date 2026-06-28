import type { ActivityDeps, LanguagePluginRegistry } from './ActivityDeps.js';
import type { WorkflowConfig } from '../config/index.js';

/**
 * Factory that wires all concrete providers into the ActivityDeps contract.
 * Called once at worker startup.
 *
 * Language plugins are constructed with config pulled from
 * `WorkflowConfig.languageConfig`, so adding a new language is a two-step:
 *   1. Publish a `@tacv/plugin-<lang>` package implementing ILanguagePlugin.
 *   2. Register it here and (optionally) add a `languageConfig.<lang>` section.
 * No other files need to change.
 */
export async function createDeps(config: WorkflowConfig): Promise<ActivityDeps> {
  const { createLogger } = await import('../observability/logger.js');
  const log = createLogger('tacv.worker');

  // ── Agent provider — tiered construction ─────────────────────────────────
  let agent: ActivityDeps['agent'];
  try {
    const { ClaudeAgentSdkProvider } = await import('@tacv/provider-claude');
    const { LangfuseTracingAgent }   = await import('@tacv/provider-claude');
    const { BudgetAwareAgent }       = await import('./infrastructure/BudgetAwareAgent.js');

    const base = new ClaudeAgentSdkProvider({
      model: config.agentModel,
      costPerMInput:  config.tokenBudget.costPerMInput,
      costPerMOutput: config.tokenBudget.costPerMOutput,
    });
    const traced = config.langfuse.enabled && config.langfuse.publicKey
      ? new LangfuseTracingAgent(base, `tacv-worker-${Date.now()}`, {
          publicKey: config.langfuse.publicKey,
          secretKey: config.langfuse.secretKey ?? '',
        })
      : base;
    agent = new BudgetAwareAgent(traced, config.tokenBudget);
    log.info('createDeps.using_agent_sdk');
  } catch (sdkErr) {
    log.warn('createDeps.agent_sdk_unavailable', { error: String(sdkErr) });
    try {
      const { ClaudeAgentProvider }  = await import('@tacv/provider-claude');
      const { LangfuseTracingAgent } = await import('@tacv/provider-claude');
      const { BudgetAwareAgent }     = await import('./infrastructure/BudgetAwareAgent.js');

      const base = new ClaudeAgentProvider({
        apiKey:         process.env['ANTHROPIC_API_KEY'] ?? '',
        model:          config.agentModel,
        costPerMInput:  config.tokenBudget.costPerMInput,
        costPerMOutput: config.tokenBudget.costPerMOutput,
      });
      const traced = config.langfuse.enabled && config.langfuse.publicKey
        ? new LangfuseTracingAgent(base, `tacv-worker-${Date.now()}`, {
            publicKey: config.langfuse.publicKey,
            secretKey: config.langfuse.secretKey ?? '',
          })
        : base;
      agent = new BudgetAwareAgent(traced, config.tokenBudget);
      log.info('createDeps.using_classic_sdk');
    } catch {
      log.warn('createDeps.claude_unavailable_using_stub');
      const { StubAgentProvider } = await import('@tacv/stubs');
      agent = new StubAgentProvider();
    }
  }

  // ── Structured extractor ──────────────────────────────────────────────────
  let extractor: ActivityDeps['extractor'];
  try {
    const { ClaudeStructuredExtractor } = await import('@tacv/provider-claude');
    extractor = new ClaudeStructuredExtractor({
      apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
      defaultModel: 'claude-haiku-4-5-20251001',
    });
  } catch {
    const { StubStructuredExtractor } = await import('@tacv/stubs');
    extractor = new StubStructuredExtractor({});
  }

  // ── Memory provider ───────────────────────────────────────────────────────
  let memory: ActivityDeps['memory'];
  if (config.mem0VectorStore !== 'in-memory') {
    try {
      const { Mem0MemoryProvider } = await import('@tacv/provider-mem0');
      memory = new Mem0MemoryProvider({
        apiKey:             process.env['ANTHROPIC_API_KEY'] ?? '',
        vectorStore:        config.mem0VectorStore,
        vectorStoreConfig:  config.mem0Config as Record<string, unknown>,
      });
    } catch {
      const { InMemoryProvider } = await import('@tacv/memory');
      memory = new InMemoryProvider();
    }
  } else {
    const { InMemoryProvider } = await import('@tacv/memory');
    memory = new InMemoryProvider();
  }

  // ── Sandbox provider ──────────────────────────────────────────────────────
  let sandbox: ActivityDeps['sandbox'];
  try {
    const { DockerSandboxProvider } = await import('@tacv/provider-docker');
    sandbox = new DockerSandboxProvider({ repoPath: config.repoPath });
  } catch {
    const { StubSandboxProvider } = await import('@tacv/stubs');
    sandbox = new StubSandboxProvider();
  }

  // ── Code graph ────────────────────────────────────────────────────────────
  const { CodeGraphService } = await import('@tacv/code-graph');

  // ── Library docs ──────────────────────────────────────────────────────────
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

  // ── Language plugin registry ──────────────────────────────────────────────
  //
  // Each plugin is constructed with values from `config.languageConfig[langId]`.
  // To add a new language:
  //   1. Install the plugin package.
  //   2. Add a try/catch block below mirroring the TypeScript or Java pattern.
  //   3. Optionally add a `languageConfig.<langId>` section to tacv.json.
  //
  const { LanguagePluginRegistry } = await import('@tacv/language-plugins-base');
  const pluginRegistry             = new LanguagePluginRegistry();

  // ── TypeScript / JavaScript ───────────────────────────────────────────────
  try {
    const {
      TypeScriptPlugin,
      ReactProfile, FastifyProfile, VueProfile, ExpressProfile, NextJsProfile,
    } = await import('@tacv/plugin-typescript');

    const tsConf = config.languageConfig?.['typescript'] ?? {};
    pluginRegistry.register(new TypeScriptPlugin(
      [new ReactProfile(), new FastifyProfile(), new VueProfile(), new ExpressProfile(), new NextJsProfile()],
      {
        userSrcRoot: tsConf.userSrcRoot ?? config.debug.userTsSrcRoot ?? 'src',
        debugPort:   tsConf.debugPort   ?? config.debug.cdpPort       ?? 9229,
      },
    ));
    log.info('createDeps.plugin_registered', { languageId: 'typescript' });
  } catch (e) {
    log.warn('createDeps.ts_plugin_unavailable', { error: String(e) });
  }

  // ── Java / Spring Boot ────────────────────────────────────────────────────
  try {
    const { JavaPlugin, SpringBootProfile } = await import('@tacv/plugin-java');

    const javaConf = config.languageConfig?.['java'] ?? {};
    pluginRegistry.register(new JavaPlugin(
      [new SpringBootProfile()],
      {
        userPackage:     javaConf.userPackage     ?? config.debug.userJavaPackage ?? 'com.example',
        debugPort:       javaConf.debugPort       ?? config.debug.jdwpPort        ?? 5005,
        actuatorBaseUrl: javaConf.actuatorBaseUrl ?? config.debug.actuatorBaseUrl ?? 'http://localhost:8080/actuator',
      },
    ));
    log.info('createDeps.plugin_registered', { languageId: 'java' });
  } catch (e) {
    log.warn('createDeps.java_plugin_unavailable', { error: String(e) });
  }

  // ── Python (example third-party plugin — will gracefully skip if not installed) ──
  try {
    const { PythonPlugin } = await import('@tacv/plugin-python');
    const pyConf = config.languageConfig?.['python'] ?? {};
    pluginRegistry.register(new PythonPlugin({ debugPort: pyConf.debugPort ?? 5678 }));
    log.info('createDeps.plugin_registered', { languageId: 'python' });
  } catch { /* not installed — skip silently */ }

  // ── Validate repoPath ──────────────────────────────────────────────────────
  const { validateRepoPath: validateRepoPath_ } = await import('./infrastructure/repoPathValidation.js');
  await validateRepoPath_(config.repoPath);

  return {
    config,
    agent,
    extractor,
    memory,
    sandbox,
    codeGraph:      new CodeGraphService() as never,
    libraryDocs,
    pluginRegistry: pluginRegistry as unknown as LanguagePluginRegistry,
    log,
    repoPath:  config.repoPath,
    taskId:    '',   // overridden per-activity call
    sessionId: '',   // overridden per-activity call
  };
}
