# TACV — TypeScript Agentic Coding Workflow

A production-grade agentic coding workflow powered by **Temporal.io**, the **Claude Agent SDK**, and a modular **language plugin system**. It enforces rigorous TDD, catches regressions through multi-layered verification, and learns across sessions via **Mem0** memory.

## Architecture

```
Temporal Workflow (durable execution)
    └── Activities (auto-instrumented with OTel + Pino)
         ├── Bootstrap → Scout → ValueNode → TDDGate
         ├── Actor (Claude Agent SDK) → Preflight → Critics → Verifier
         │   ├── Critics: Security, TestPreservation, DependencyVuln, Architecture/Compatibility
         │   └── Verifier: TypeCheck → ProtectionTests → AcceptanceTests → API Tests → Coverage → Mutations → Visual
         ├── IntelligentDebugger (JDWP/CDP/Actuator/DeltaDebug)
         ├── SpeculativeBranch (child workflows, parallel)
         ├── HITLEscalation (Temporal signals, 48hr wait)
         └── MemoryConsolidation (Mem0, AGENTS.md update, sleep-cycle purge)
```

## Quick Start

### Prerequisites
- Node.js 20+ with pnpm 9+
- Docker (with gVisor for production)
- Temporal server (see `docker/compose/`)

### Start Temporal
```bash
docker compose -f docker/compose/docker-compose.temporal.yml up -d
```

### Install & Build
```bash
pnpm install
pnpm build
```

### Set Environment Variables
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export TACV_CONFIG=./tacv.json    # optional
export LOG_FORMAT=pretty           # pretty | json
export LOG_LEVEL=info
```

### Start the Worker
```bash
pnpm --filter @tacv/core start:worker
```

### Run a Task
```bash
# GREENFIELD: new Java/Spring Boot backend feature
pnpm tacv run \
  --task-id feature-user-auth \
  --description "Add JWT authentication to the user service with login, refresh, and logout endpoints" \
  --mode GREENFIELD \
  --module java-backend \
  --languages java \
  --repo /path/to/your/project

# BROWNFIELD: TypeScript frontend change
pnpm tacv run \
  --task-id fix-mobile-nav \
  --description "Fix the mobile navigation drawer — it doesn't close when clicking outside" \
  --mode BROWNFIELD \
  --module ts-frontend \
  --languages typescript \
  --repo /path/to/your/project
```

### Resume after HITL
```bash
pnpm tacv resume --workflow-id feature-user-auth --action override \
  --guidance "Use RS256 for JWT signing, store keys in AWS Secrets Manager"
```

### Check Status
```bash
pnpm tacv status --workflow-id feature-user-auth
```

## Configuration (`tacv.json`)

```json
{
  "agentModel": "claude-opus-4-6",
  "maxSelfCorrectionCycles": 6,
  "tokenBudget": { "criticalDollar": 80, "warningDollar": 50 },
  "mutation": { "enabled": true, "minimumScore": 70 },
  "visual": { "enabled": true, "viewports": ["mobile", "tablet", "desktop"] },
  "libraryDocs": { "provider": "context7" },
  "langfuse": { "enabled": true, "publicKey": "...", "secretKey": "..." },
  "shadowMode": { "enabled": true, "cronSchedule": "0 2 * * *" }
}
```

## Adding Language Support

Create a single file implementing `ILanguagePlugin`:

```typescript
// packages/language-plugins/rust/src/RustPlugin.ts
export class RustPlugin implements ILanguagePlugin {
  readonly metadata = { languageId: 'rust', displayName: 'Rust', extensions: ['.rs'], testFramework: 'cargo test', buildTool: 'cargo' };
  // implement ILanguagePlugin methods...
}
```

Register in the worker:
```typescript
pluginRegistry.register(new RustPlugin());
```

That's it. Nothing else changes.

## Adding Framework Profiles

```typescript
// packages/language-plugins/typescript/src/profiles/VueProfile.ts
export class VueProfile implements IFrameworkProfile {
  readonly profileId = 'vue';
  matches(filePath: string): boolean { return /src\/(components|views)\/.*\.vue$/.test(filePath); }
  // ...
}
```

## Testing

```bash
# All packages
pnpm test

# With coverage
pnpm test:cov

# Specific package
pnpm --filter @tacv/core test
pnpm --filter @tacv/plugin-typescript test
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Temporal.io** over LangGraph | Durable execution, signal-based HITL, Web UI, per-activity retry/timeout |
| **Claude Agent SDK** for Actor | Native agentic loop — no manual turn management |
| **Instructor** for structured extraction | Auto-retry with validation feedback; separate from Agent SDK |
| **Zod** for all state | Runtime validation + TypeScript inference; no reducers or sentinels |
| **Language plugins** | Add any language by implementing one interface; no workflow changes |
| **Framework profiles** | Framework-specific tests without combinatorial plugin explosion |
| **Mem0** for memory | TypeScript SDK, episodic+procedural, built-in dedup, Qdrant/PGVector backends |
| **tree-sitter** for AST | Industry standard, 100+ languages, fast incremental parsing |
| **ObservabilityInterceptor** | Zero-instrumentation activities; all OTel/Pino auto-applied |
| **ILibraryDocsProvider** | Context7 replaceable via interface; swap without touching workflow |
