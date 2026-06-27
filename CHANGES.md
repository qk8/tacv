# TACV Redesign — Change Log

All improvements relative to the original `tacv-main` codebase.

---

## Critical Bug Fixes

### 1. Speculative branches are now truly parallel
**File:** `src/workflows/CodingWorkflow.ts`  
**Problem:** `SpeculativeBranchWorkflow` iterated candidates in a `for...of` loop.
The README said "parallel" but the implementation was fully sequential — 3 branches took 3× as long as 1.  
**Fix:** The parent workflow now launches one `SpeculativeBranchWorkflow` child per candidate via `Promise.allSettled`. Each branch gets its own Temporal workflow ID for visibility in the Web UI. `SpeculativeBranchWorkflow` now handles exactly ONE strategy.

### 2. Verifier monolith split into 5 staged activities
**File:** `src/activities/verification/stages.ts`  
**Problem:** All 7 verification steps ran inside a single 10-minute Temporal activity with one shared retry policy. A visual screenshot failure at minute 9 forced type-checking and unit tests to re-run.  
**Fix:** 5 separate registered activities with independent timeouts and retry policies:
- `runVerifierTypeCheck` — 2 min timeout, 2 retries
- `runVerifierTests` — 10 min timeout, 2 retries  
- `runVerifierApi` — 5 min timeout, 2 retries
- `runVerifierMutation` — 5 min timeout, 1 retry (expensive)
- `runVerifierVisual` — 10 min timeout, 1 retry (flaky environment)

Each stage short-circuits: if the previous set a `FAIL` verdict, it skips immediately.

### 3. `TestFaultAssessment` and `FeasibilityAssessment` were undefined at runtime
**Files:** `src/activities/test-validity/impl.ts`, `src/activities/feasibility/impl.ts`  
**Problem:** Both files used `import type { ..., SchemaName }` — type-only imports — but then passed `SchemaName` as a runtime value to `extractor.extract(prompt, SchemaName, opts)`. At runtime, the schema was `undefined`, causing the fallback stub extractor to throw and silently return `{}`. The extractor mock was never reached.  
**Fix:** Split into `import type { WorkflowState }` and `import { SchemaName }` for schemas used as values. Same fix applied to `memory/impl.ts`, `actor/impl.ts`, `replan/impl.ts`.

---

## New Features

### 4. Baseline Verification (new phase before correction loop)
**File:** `src/activities/baseline/impl.ts`  
**Config:** `config.baseline.{ enabled, failFast }`  
Runs the existing protection test suite BEFORE the agent touches any code. Catches "tests were already broken before we started" immediately, preventing the agent from burning its entire budget on pre-existing failures.

When `failFast=true` (default), a failing baseline escalates directly to HITL with a clear message: "Fix baseline first." When `failFast=false`, the workflow continues with the baseline results recorded in state for context.

### 5. Implementation Planning (new phase after Value Node)
**File:** `src/activities/planning/impl.ts`  
**Config:** `config.planning.{ enabled, validateWithFastCritics, model }`  
The agent produces a file-by-file implementation plan BEFORE writing any code. Fast-lane critics validate the plan structure (scope, file count, risk areas). The plan is stored in `state.implementationPlan` and provided in every subsequent actor prompt as a task anchor, reducing context drift across cycles.

Critics that approve the plan set `criticsApproved=true`; warnings record `fastCriticFindings`. The phase never blocks — if planning fails (e.g., LLM timeout), the workflow continues to TDD Gate with `implementationPlan=null`.

### 6. Git Checkpoint (new step after each PASS)
**File:** `src/activities/git-checkpoint/impl.ts`  
**Config:** `config.gitCheckpoint.{ enabled, branchPrefix, authorName, authorEmail }`  
After each successful verifier pass, creates a git commit on a dedicated branch (`{branchPrefix}{taskId}`). Benefits:
- True rollback: speculative branches can fork from a known-good commit
- Audit trail: git history shows exactly what changed at each correction cycle
- PR creation: the committed branch is ready to open as a PR

Git failures are non-fatal — if git is unavailable, a warning is logged and `state.gitCheckpoint.commitHash` is set to `null`.

---

## Architecture Improvements

### 7. Critics split into fast and semantic lanes
**File:** `src/activities/critics/impl.ts`  
**Config:** `config.criticLanes.{ alwaysRunSemantic, semanticLaneDeferCycles }`  
Previously all 11 critics ran in parallel every cycle regardless of LLM cost.

**Fast lane** (no LLM, runs every cycle): `security`, `style`, `consistency`, `test_preservation`, `dependency_vuln`, `architecture`, `compatibility`, `performance`  
**Semantic lane** (LLM-based, deferred until `cycle >= semanticLaneDeferCycles`): `scope_creep`, `requirement_trace`, `openapi_contract`

Default: semantic critics only run from cycle 1 onwards (`semanticLaneDeferCycles=1`). This saves ~$0.08–0.15 per cycle on early failures where the code doesn't even compile yet. Set `alwaysRunSemantic=true` to restore original behavior.

Exported: `getCriticLanes()`, `getCriticDefs()`, `allCriticsImpl(state, deps, lane)` where `lane` is `'fast' | 'semantic' | 'all'`. Registered as: `runAllCritics`, `runFastCritics`, `runSemanticCritics`.

### 8. Jaccard-based semantic stagnation detection
**File:** `src/activities/stagnation/impl.ts`  
**Previous approach:** Hash prefix comparison (`longestCommonPrefix(h1, h2).length / max(h1.length, h2.length)`) was semantically meaningless — the djb2 hash of two identical errors expressed differently in Node 16 vs Node 18 share zero prefix bits.

**New approach:** Three-tier detection:
1. **Iteration** — identical error hash (exact same failures)
2. **Outcome** — error hash appears in recent history (cycle saw this before)  
3. **Semantic** — Jaccard coefficient on word sets exceeds threshold (default 0.40)

`extractMeaningfulWords()` normalises, lowercases, deduplicates words ≥4 chars. `computeTextSimilarity()` computes `|A ∩ B| / |A ∪ B|`. The threshold 0.40 (40% word overlap) correctly identifies "Cannot read property 'foo' of undefined" and "Cannot read properties of undefined (reading 'foo')" as the same error class.

### 9. Debugger fallback error classification
**File:** `src/activities/debugger/impl.ts`  
The fallback text analysis (used when `@tacv/debugger` is unavailable) previously hardcoded `errorType: 'UNKNOWN'`. Now applies pattern-based classification over the raw failure text: `NULL_REFERENCE`, `BEAN_CREATION_ERROR`, `TYPE_MISMATCH`, `ASSERTION_FAILURE`, `NETWORK_ERROR`, and 12 more categories for both Java and TypeScript stacks.

---

## Pre-existing Bugs Fixed

- `compatibilityCritic`: used `state.task.languageIds[0]` for all diffs, ignoring per-diff `language` field. Fixed to prefer `diff.language` for correct TS/Java detection in multi-language repos.
- `securityCritic`: SQL injection pattern only matched `.query +` idiom. Expanded to cover `"SELECT *" +` and template-literal concatenation patterns.
- `memoryConsolidationImpl`: `review.concerns` could be `undefined` if extractor returned a partial value, causing `qualityIssues.length` to throw. Fixed with null-guard `?? []`.
- `performanceCritic`: stub `runBenchmarks` returned `{ benchmarks: [] }` causing early exit before baseline store. Updated stub to return a representative benchmark.
- `testValidityReviewImpl`: `TestFaultAssessment` was undefined at runtime due to `import type`. Fixed to value import.
- All test files with `deps.pluginRegistry = { get: () => ({ ...deps.pluginRegistry.get('X'), ... }) }` — circular reference causing stack overflow. Fixed to capture the original plugin reference before reassignment.

---

## Test Coverage

- **7 new test suites** covering all new activities (323 total tests, 48 test files, all green)
- `baseline.test.ts` — 8 tests
- `planning.test.ts` — 7 tests
- `git-checkpoint.test.ts` — 7 tests
- `verification/stagedVerifier.test.ts` — 16 tests (including pipeline composition / short-circuit)
- `critics/criticLanes.test.ts` — 10 tests (lane membership, deferred execution, both lanes)
- `stagnation.test.ts` — 14 tests (rewritten, covers Jaccard similarity and all 3 stagnation patterns)
- 5 pre-existing test files fixed (circular refs, import type bugs, stub data)

---

## New Config Fields

```typescript
config.baseline       = { enabled: boolean, failFast: boolean }
config.planning       = { enabled: boolean, validateWithFastCritics: boolean, model: string }
config.gitCheckpoint  = { enabled: boolean, branchPrefix: string, authorName: string, authorEmail: string }
config.criticLanes    = { alwaysRunSemantic: boolean, semanticLaneDeferCycles: number }
```

## New State Fields

```typescript
state.baselineTestResult  : BaselineTestResult | null
state.implementationPlan  : ImplementationPlan | null
state.gitCheckpoint       : GitCheckpoint | null
state.sessionScratchpad   : string | null
```
