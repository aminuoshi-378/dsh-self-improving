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

## Status

Design phase. Not yet implemented.
