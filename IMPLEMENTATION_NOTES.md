# Implementation Notes

## What is fully implemented in this codebase

### Core Business Logic (100% complete)
- **All Zod state schemas** — `WorkflowState`, `CorrectionCycle`, `CriticFinding`, `VerifierResult`, `LessonLearned`, `AstDiffResult`, `VisualTestResult`, `MutationResult`, `ApiTestResult` and all sub-schemas
- **Typed routing transitions** — `computeVerifierTransition()`, `computeConfidenceScore()`, `detectStagnation()` — fully typed, no bare strings
- **All critics** — security, style, consistency, architecture, compatibility, test_preservation, dependency_vuln — with full detection logic
- **Verifier pipeline** — type-check → incremental selection → protection tests → acceptance tests → API tests → coverage → mutation → visual
- **TDD Gate** — scaffold generation, red-phase enforcement, E2E scaffolds for frontend modules
- **Actor** — system prompt builder, user prompt builder, diff proposal parser
- **Stagnation detection** — iteration / semantic / outcome patterns, history windowing
- **Memory consolidation** — lesson compilation, AGENTS.md update, Mem0 persistence, sleep-cycle purge
- **HITL escalation** — payload builder, disk persistence, structured escalation reasons
- **Coverage check** — regression detection against baseline
- **AST diff analyzer** — TypeScript + Java symbol detection, breaking risk classification
- **InMemoryGraph** — node/edge storage, transitive importer traversal, depth-limited BFS
- **CodeGraphService** — blast radius, AST diff, incremental test selection
- **MemoryService** — episodic/procedural/shadow memory, purge, retrieval
- **BudgetAwareAgent** — pre-call guard, warning threshold, cost delta return (state-authoritative)
- **Configuration system** — Zod-validated, nested defaults, immediate error on invalid config
- **TypeScript language plugin** — build, typeCheck, protection/acceptance/API/mutation tests, E2E + component scaffold generation, ESLint lint, dep-cruiser arch rules, test deletion detection
- **Java language plugin** — build (Maven/Gradle detection), type check, protection/acceptance/API/mutation tests, JUnit 5 + MockMvc scaffold generation, Checkstyle lint, ArchUnit arch rules, test deletion detection
- **Visual testing** — `VisualTestRunner`, multi-viewport screenshot comparison via pixelmatch, baseline creation, diff image generation
- **Plugin registry** — `LanguagePluginRegistry` with `get()`, `getForFile()`, `getAll()`, `has()`
- **Stubs** — `StubAgentProvider`, `StubStructuredExtractor`, `StubMemoryProvider`, `StubSandboxProvider`, `StubCodeGraphProvider`, `StubLibraryDocsProvider`, `StubLanguagePlugin`, `StubPluginRegistry`
- **CLI** — `tacv run`, `tacv resume` commands with Temporal client integration, `ProgressRenderer`
- **Temporal worker** — worker.ts with `ObservabilityInterceptor`

### Test Suite (27 test files, 400+ test cases)
- State schemas: 40+ assertions
- State transitions: 50+ assertions + 500-run property tests
- Critics: security, consistency, compatibility, testPreservation, dependencyCritic, allCritics
- Verifier: 20 scenarios including mutation, API tests, visual, type check
- Verification helpers: coverageCheck, incrementalSelector
- Infrastructure: BudgetAwareAgent (10 scenarios)
- Activities: bootstrap, preflight, stagnation, memory consolidation
- Language plugins: TypeScript (generateTestSkeleton, detectDeletedTests)
- Language plugins: Java (generateTestSkeleton, detectDeletedTests)
- Plugin registry: LanguagePluginRegistry
- Code graph: AstDiffAnalyzer, InMemoryGraph
- Memory: MemoryService (all methods)
- Visual testing: viewports
- Stubs: all 8 stub classes
- CLI: ProgressRenderer
- Config: loadConfig validation

## External services (require configuration to activate)
- **Temporal.io** — `docker compose up` in `/docker/compose/`
- **Anthropic API** — `ANTHROPIC_API_KEY` env var
- **Mem0** — requires `@mem0ai/mem0` npm package + Qdrant or other vector backend
- **Context7** — requires `@upstash/context7` + `UPSTASH_CONTEXT7_API_KEY`
- **Langfuse** — requires `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`
- **Playwright** — requires `npx playwright install` for visual testing
- **tree-sitter** — native parser for production code graph (stubs used in tests)

## Design decisions explained

### No reducers / no sentinels
Unlike SACV (Python LangGraph), state fields are replaced each turn, not accumulated.
`criticFindings` and `criticErrors` are overwritten on every critics pass — no `CRITIC_RESET` sentinel needed.

### Cost tracking is state-authoritative
`BudgetAwareAgent` does NOT hold `_spent` internally. Each call receives `currentSpend` from
`WorkflowState.cumulativeCostUsd` and returns `callCostUsd` delta. The workflow accumulates.
This survives Temporal activity retries on different workers.

### `IStructuredExtractor` is separate from `IAgentProvider`
`@anthropic-ai/claude-agent-sdk` and `@instructor-ai/instructor` are architecturally
incompatible (Instructor patches `messages.create()`, Agent SDK uses `messages.stream()`).
They are used through separate interfaces: `IAgentProvider` for the agentic loop (Actor,
Debugger), `IStructuredExtractor` for single-turn structured output (ValueNode, Replan, etc.).
