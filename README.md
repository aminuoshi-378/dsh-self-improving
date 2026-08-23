# dsh-ai-enhancements

Plugin packs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — a suite of optional, independently-mountable dsh plugins organized as two packs:

1. **[`dsh-self-improving/`](#1-dsh-self-improving--cross-session-learning)** — a cross-session **learning layer**.
2. **[`dsh-rule-enforcement/`](#2-dsh-rule-enforcement--cross-project-rules)** — a user **soft-rules** engine.

Each pack can be mounted **standalone** (its sub-plugins) or **together**. See the per-pack sections below.

> Docs: [Design](docs/design.md) · [Plugin Dev Notes](docs/plugin-dev-notes.md) · [CHANGELOG](CHANGELOG.md)
> 中文版：[README.zh-CN.md](README.zh-CN.md)

---

## 1. `dsh-self-improving/` — Cross-session learning

A self-improving layer that dsh itself lacks: runtime self-modification exists (`cordis_*` toolset), but **cross-session learning** doesn't — feedback is never consumed, behavior params are static, dynamic plugins vanish on restart.

This pack adds the learning layer **on top of the deterministic loop**, injecting learnings through existing extension points **without modifying the loop**.

### Architecture

```
Layer 4: Meta-Cognition Engine        — reflect on turns, extract lessons (async, idle)
Layer 3: Experience Store              — cross-session persistent memory (SQLite)
Layer 2: Behavior Adapter               — inject learned experience (advisory)
Layer 1: Outcome Evaluator              — score each turn (agent/turn-stopping, read-only)
Layer 0: Existing deterministic loop    — unchanged
```

All injection is **advisory** (the model may heed or ignore it). Unload the plugin → fully deterministic behavior returns.

### Structure

```
src/
├── types/index.ts                    # Shared types (TurnOutcome, ExperienceRecord, …)
├── store/experience-store.ts         # Layer 3: SQLite persistent memory
├── evaluator/outcome-evaluator.ts    # Layer 1: read-only turn scoring
├── adapter/behavior-adapter.ts       # Layer 2: advisory experience/preference injection
├── meta-cognition/meta-cognition-engine.ts  # Layer 4: LLM reflection + lessons
└── index.ts                          # Plugin entry (apply + exports)
test/    # 7 + 6 + 8 + 8 unit tests, all passing
benchmark/  # 20 scenarios, simulated A/B runner + HTML report
cordis.yml  # dsh mount config
```

### Getting started

```bash
npm install
npm test
npm run benchmark   # then open benchmark-report.html
```

### Mount in dsh

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

### How it works

1. **Evaluate** — `OutcomeEvaluator` scores each turn at `agent/turn-stopping` (goal progress, tool success, guards, user feedback) → writes to the store.
2. **Inject** — `BehaviorAdapter` retrieves similar past experience at `agent/pre-step` ("Past Experience" block) and appends "Learned Preferences" at `system-prompt/assemble`.
3. **Reflect** — during idle, the `MetaCognitionEngine` runs structural reflection on closed turns (`deepseek-chat`, low cost) and writes reusable `lesson` back.
4. **Freshen** — keep latest 1000; confidence decays with reuse unless re-validated by a new positive outcome.

| Mount point | Mode | Role |
|---|---|---|
| `agent/turn-stopping` | serial | evaluator scores |
| `agent/pre-step` | waterfall | inject experience |
| `system-prompt/assemble` | section | inject learned preferences |
| `turn/end` | durable | queue turn for reflection |
| `agent/run-maintenance` | event | process reflection queue |
| plugin unload | effect | close store |

### Status

Phases 1–3 implemented, 29 tests passing. Phase 4 (adaptive strategy) pending.

---

## 2. `dsh-rule-enforcement/` — User soft-rules injection

A minimal plugin: injects **a block of text the user edits in the WebUI**
(markdown) into the agent's system prompt as advisory guidance — the model may
heed or ignore it.

- Edit entry: Settings → `dsh-rule-enforcement` `rules` field
- Stored in `$DSH_HOME/settings.yaml`; changes take effect **live** (no restart)
- Only dsh services used: `settings` (store text) + `systemPrompt` (inject)

### Install

```bash
cd dsh-rule-enforcement
pnpm install        # install deps
pnpm run build      # build → dist/
pnpm pack           # pack → dsh-rule-enforcement-0.1.4.tgz
dsh plugin --profile web add D:\absolute-path\dsh-rule-enforcement-0.1.4.tgz   # mount into web profile
```

- Use an **absolute path** for the tarball
- To re-install the same version, first `dsh plugin --profile web remove dsh-rule-enforcement`
- If `pnpm install` fails on `esbuild`, add `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`

### WebUI editor (optional)

The Rules editor lives in a separate GUI plugin. Build, pack, and install it the
same way from `src/gui`:

```bash
cd dsh-rule-enforcement/src/gui
pnpm install        # install deps
pnpm run build      # build → lib/
pnpm run bundle     # bundle → lib/client.js
pnpm pack           # pack → dsh-rule-enforcement-gui-VERSION.tgz
dsh plugin --profile web add D:\absolute-path\dsh-rule-enforcement-gui-0.1.3.tgz   # mount into web profile
```

After restarting `dsh web`, edit rules at Settings → Plugins → **Rules**.

### Config

```yaml
# the plugin's namespace in settings.yaml
dsh-rule-enforcement:
  rules: |
    # rules you want the agent to follow (markdown, injected into the system prompt)
    - reply in Chinese
    - update CHANGELOG before committing
```

### Development

```bash
cd dsh-rule-enforcement
pnpm install
pnpm run typecheck
pnpm test
```

---

## Combined install

Both packs coexist in the same profile — just insert both (dsh's normal plugin combinator):

```yaml
- insert:
    - id: self-improving            # from dsh-self-improving
      name: dsh-self-improving
      config: { ... }
    - id: dsh-rule-enforcement      # from dsh-rule-enforcement (soft rules)
      name: dsh-rule-enforcement
      config: { ... }
```

A single top-level "preset" package that mounts both in one shot is NOT implemented — but it's unnecessary in dsh, whose profile composition already serves as the top-level preset.