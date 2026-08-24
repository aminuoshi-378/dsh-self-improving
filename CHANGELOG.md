# Changelog

All notable changes to `dsh-self-improving` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`dsh-rule-enforcement` pack** — user soft-rules injection
  - Minimal plugin: injects a single markdown text the user edits (via `$DSH_HOME/settings.yaml` or the WebUI) into the agent's system prompt as **advisory** guidance (`systemPrompt.section`, order 100)
  - Soft rules only: hard red-line enforcement removed
  - Live reload: changes take effect without restart (`settings.watch`)
  - `dsh-rule-enforcement-gui@0.1.3` — WebUI Rules editor tab (Settings → Plugins → Rules)
    - Reads/writes via `ctx.settingsScope.bind` (fix: `Cannot read properties of undefined (reading 'save')` — slot system flattens the inject face into top-level props, not a nested `inject` object)
  - Docs: simplified zh/en READMEs (commands + brief notes only)
  - Fix: `getRulesFilePath` test now compares with `normalize()` for cross-platform path separators (was failing on Windows)
  - Docs: restored English `README.md` (per AGENTS.md), synced with `README.zh-CN.md`; GUI sub-README no longer hard-codes a stale tarball version
  - Fix: upgraded `better-sqlite3@11` → `^12.11.1` and added `.npmrc` (npmmirror prebuild mirror) so the native module installs on Node 24 without a VS C++ toolchain (v11 has no Node-24 prebuilt and fell back to failing `node-gyp`)

### Planned
- **Phase 4** — Adaptive Strategy Adjustment
  - `agent/request` waterfall: model selection based on historical success rate
  - `tools/restrict`: tool recommendation based on historical usage patterns
  - Guard threshold auto-tuning for `repeat-tool-reminder`

## [0.1.0] - 2026-08-23

### Added
- **Phase 1 — Experience Store + Outcome Evaluator (minimal closed loop)**
  - SQLite-backed `ExperienceStore` (reuses session-persistence infrastructure)
    - Schema: `(context_hash, task_pattern, tools_used, workspace_digest, actions, outcome_score, user_feedback, lesson, tags, confidence, reuse_count)`
    - Indexed on `context_hash`, `task_pattern`, `outcome_score DESC`
    - Retention: latest 1000 records; eviction by `outcome_score` + recency
    - Confidence decay: weight decreases with reuse unless re-validated
  - `OutcomeEvaluator` (Layer 1) — read-only turn scorer
    - Mounted on `agent/turn-stopping` (serial)
    - Inputs: `goalProgress`, `toolCallCount`, `toolSuccessRate`, `guardTriggerCount`, `userFeedback`
    - Output: weighted composite `outcomeScore` (0.0–1.0) via `SCORE_WEIGHTS`
  - 7 store tests + 6 evaluator tests

- **Phase 2 — Behavior Adapter (advisory experience injection)**
  - `BehaviorAdapter` (Layer 2) — three injection points
    - `agent/pre-step` (waterfall): "Past Experience" markdown block (must call `next()`)
    - `system-prompt/assemble`: dynamic `Learned Preferences` section (order 450)
    - `agent/request` (waterfall): model/parameter selection by historical success rate
  - Context-signature fuzzy matching (task pattern + tool combo + workspace digest)
  - Preferences distillation from accumulated feedback
  - 8 adapter tests

- **Phase 3 — Meta-Cognition Engine (LLM reflection)**
  - `MetaCognitionEngine` (Layer 4)
    - Mounted on `turn/end` (durable) → queue reflection
    - Mounted on `agent/run-maintenance` → process queue asynchronously (idle-time)
    - Uses low-cost `deepseek-chat` (not `deepseek-reasoner`) to control overhead
    - Generates `{what_worked, what_failed, what_to_try_differently, reusable_lesson}`
    - Writes `lesson` to Experience Store, applies confidence boost on re-validation
  - Optional: can be disabled via `metaCognitionEnabled: false`; Layers 1–3 still form a closed loop
  - 8 meta-cognition tests

- **Plugin entry point** — `apply(ctx, config)` Cordis plugin
  - Graceful degradation: when `ctx.on` / `ctx.systemPrompt` / `ctx.effect` are absent (standalone test mode), all layers become no-ops
  - Auto-cleanup: store closed on plugin unload
  - Config schema: `dbPath`, `metaCognitionEnabled`, `behaviorAdapterEnabled`, `maxRecords`, `minInjectionScore`

- **Benchmark suite** (A/B comparison)
  - `benchmark/task-suite.ts` — 20 predefined agent task scenarios with optimal paths
  - `benchmark/sim-agent.ts` — simulated agent (with/without experience modes)
  - `benchmark/run-benchmark.ts` — runner + HTML report generator
  - Outputs `benchmark-report.html` / `benchmark-report.json`

- **Documentation**
  - `README.md` — overview, structure, getting started, mounting guide
  - `docs/design.md` — full four-layer architecture, security boundaries, phased path
  - `docs/plugin-dev-notes.md` — practical dsh plugin conventions distilled from the codebase

- **Mount configuration** — `cordis.yml` for dsh profile integration

### Security
- All injection is **advisory** (model can heed or ignore) — no forced config mutation
- Evaluator is **read-only** — never modifies agent behavior or turn output
- Experience Store is **local-only** (same trust boundary as session logs); no telemetry export without explicit opt-in
- Plugin is **unloadable** — returns agent to fully deterministic behavior

### Dependencies
- Runtime: `@langchain/core`, `agentevals`, `better-sqlite3`, `promptfoo`, `ulid`
- Dev: `tsx`, `typescript` 5.6, `@types/node`, `@types/better-sqlite3`
- Node engine: `>=20.0.0`

[Unreleased]: https://github.com/aminuoshi-378/dsh-self-improving/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aminuoshi-378/dsh-self-improving/releases/tag/v0.1.0
