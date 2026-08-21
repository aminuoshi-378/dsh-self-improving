# dsh-self-improving

A self-improving layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## What this is

DeepSeek Harness already has a capable runtime self-modification system (`packages/extensions/` — the `cordis_*` toolset lets the agent inspect its own runtime, write and mount temporary plugins, define new tools, and unload them). But it lacks **cross-session learning**: feedback is collected but never consumed, behavior parameters are static, and dynamic plugins vanish on restart.

This project adds a **learning layer** on top of the deterministic agent loop — one that consumes existing feedback data, produces persistent behavior adjustments, and injects them through dsh's existing extension points without modifying the loop itself.

## Documents

- [Design](docs/design.md) — full architecture, four-layer model, per-layer design, security boundaries, and phased implementation path.
- [Plugin Development Notes](docs/plugin-dev-notes.md) — practical pitfalls and conventions for writing dsh plugins, distilled from the codebase.

## Quick summary

```
Layer 4: Meta-Cognition Engine        — reflect on turns, extract lessons (async, idle-time)
Layer 3: Experience Store              — cross-session persistent memory (SQLite, reuses session infra)
Layer 2: Behavior Adapter               — inject learned experience into agent/pre-step, system-prompt/assemble
Layer 1: Outcome Evaluator              — score each turn's outcome (agent/turn-stopping, read-only)
Layer 0: Existing deterministic loop    — ReactLoopAgent + event log + tool pipeline (unchanged)
```

All injection is **advisory** (context the model can heed or ignore), never a forced config mutation. The learning layer is a pure plugin — unload it and the agent returns to fully deterministic behavior.

## Project Structure

```
src/
├── types/index.ts                    # Shared type definitions (TurnOutcome, ExperienceRecord, etc.)
├── store/experience-store.ts         # Layer 3: SQLite-backed persistent memory
├── evaluator/outcome-evaluator.ts    # Layer 1: Turn outcome scoring (read-only)
├── adapter/behavior-adapter.ts       # Layer 2: Advisory experience/preference injection
├── meta-cognition/
│   └── meta-cognition-engine.ts      # Layer 4: LLM-based reflection & lesson extraction
└── index.ts                          # Plugin entry point (apply function + exports)

test/
├── experience-store.test.ts          # 7 tests — store, query, eviction, confidence decay
├── outcome-evaluator.test.ts         # 6 tests — scoring, edge cases, store integration
├── behavior-adapter.test.ts          # 8 tests — injection, preferences, model suggestion
└── meta-cognition.test.ts            # 8 tests — LLM reflection, fallback, confidence boost

cordis.yml                             # dsh plugin mount configuration
```

## Getting Started

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run individual test suites
npm run test:store
npm run test:evaluator
npm run test:adapter
npm run test:meta
```

## Mounting in dsh

Add to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: self-improving
      name: dsh-self-improving
      config:
        dbPath: ~/.dsh/experiences.db
        metaCognitionEnabled: true
        behaviorAdapterEnabled: true
        maxRecords: 1000
        minInjectionScore: 0.3
```

## Status

Phases 1–3 implemented. All 29 tests passing.

- [x] **Phase 1** — Experience Store + Outcome Evaluator (minimal closed loop)
- [x] **Phase 2** — Behavior Adapter (experience/preference injection)
- [x] **Phase 3** — Meta-Cognition Engine (LLM reflection + lesson extraction)
- [ ] **Phase 4** — Adaptive Strategy Adjustment (model routing, tool recommendation, guard auto-tuning)
