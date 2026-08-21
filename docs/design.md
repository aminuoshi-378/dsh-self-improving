# Self-Improving DeepSeek Harness — Design

## Background

DeepSeek Harness (`dsh`) is a plugin-based agent harness on vendored Cordis: **everything is a plugin**, including the model adapter, tool registry, session log, and agent loop itself. Every part is replaceable from configuration. There is no privileged core to patch — you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.

### What already exists

dsh already has a complete **runtime self-modification** system in `packages/extensions/` (the self-referential Cordis toolset). Seven model-facing tools let the agent:

| Tool | Purpose |
|---|---|
| `cordis_inspect_list` | List Host/Client inspect providers and their read-only query methods |
| `cordis_inspect_query` | Execute explicit read-only queries (service signatures, event modes, tool schemas, slot tree, theme tokens) |
| `cordis_inspect_self` | Inspect the current session's dynamic plugins, packages, version pointers, source, and diagnostics |
| `cordis_define` | Define an immutable Cordis Package (new plugin or append a version to an existing one) |
| `cordis_run` | Activate a package (`mode: "run"` for first activation/restart/rollback; `mode: "update"` to switch version) |
| `cordis_stop` | Stop the current run, cancel pending approvals, preserve definitions and version pointers |
| `cordis_undefine` | Permanently delete a dynamic plugin and all its packages |

Model-written code runs in a `node:vm` sandbox with a whitelisted Context facade. Dynamic plugins are in-process only — they do not persist across restarts, do not modify `cordis.yml`, and do not install packages.

Additionally:
- **System prompts** are runtime-composable: `ctx.systemPrompt.section()`, `.context()`, `.tools()`, `.variable()` register ordered, scoped, replaceable sections.
- **Tool availability** is runtime-controllable: `ctx.tools.register()` / `ctx.tools.restrict()` with allow/deny lists.
- **Guard plugins** provide basic self-regulation: `repeat-tool-reminder` (detects consecutive identical tool calls, progressive reminders) and `timeout-policy` (enforces declared tool timeouts).
- **Feedback** is collected: `message-feedback` (per-message positive/negative ratings) and `command-feedback` (`/feedback` command, session-level text). But **neither is consumed** — no code path feeds feedback back into behavior adjustment.

### What's missing

The gap between "self-modifying" and "self-improving" is the **learning layer**:

1. **No cross-session persistence**: `agent.inject()` only affects the current session. Dynamic plugins vanish on restart. No agent-writable persistent memory store exists.
2. **No outcome evaluation**: `session-stats` collects descriptive statistics (turn/step counts, latencies) but never judges success/failure. `foldConsumedWork` does work accounting but not quality assessment.
3. **No behavior strategy adjustment**: `agent/request` waterfall allows plugins to replace LLM config, but no plugin does this based on historical results. Compaction uses a fixed template. Guard thresholds are static.
4. **No prompt strategy learning**: System prompt sections are statically configured. No mechanism adjusts prompting based on what worked before.
5. **No meta-cognition**: `cordis_inspect` tools inspect runtime state (services, plugins, tools) for debugging, not for cognitive reflection. The agent does not "think about its own thinking."
6. **No experience replay**: Session logs are event-sourced and can be replayed to rebuild state, but no code extracts (situation, action, outcome) triples for learning.

The architecture **intentionally excludes** runtime behavioral mutation because mutation breaks event-log reconstructability. The invariant (`invariant.ts`) asserts that anything model-visible must be reconstructable from the log. So the learning layer must intervene via **persistent configuration changes** and **advisory context injection**, not by secretly altering runtime state.

## Architecture

### Four-layer model

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Meta-Cognition Engine                          │
│  After a turn ends, review the decision path, extract    │
│  reusable lessons. Write to Experience Store.             │
│  Async, runs during agent idle (runMaintenance).          │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Experience Store (cross-session memory)        │
│  Stores (context, action, outcome, lesson) tuples.        │
│  SQLite-based, reuses session-persistence infrastructure. │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Behavior Adapter                               │
│  Reads Experience Store, injects learned experience at   │
│  the start of new sessions / new steps.                  │
│  Injects through existing extension points:               │
│  systemPrompt.section / agent/pre-step / agent/request   │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Outcome Evaluator                               │
│  At turn end, evaluate: did the goal advance? did tools   │
│  succeed? did guards fire? was user feedback negative?    │
│  Produces a reward signal, writes to Experience Store.   │
├─────────────────────────────────────────────────────────┤
│  Layer 0: Existing deterministic agent loop (unchanged)   │
│  ReactLoopAgent + event log + tool pipeline              │
└─────────────────────────────────────────────────────────┘
```

### Design principle

All injection is **advisory** (context the model can heed or ignore), never a forced config mutation. This preserves the LLM as the final decision-maker and keeps the deterministic loop intact. The learning layer is a pure plugin — unload it and the agent returns to fully deterministic behavior.

---

## Layer 1: Outcome Evaluator

### Mount point

`agent/turn-stopping` (serial event, fires before a turn closes). This is the last chance to observe a complete turn in flight.

### What it does

At the end of each turn, evaluate the turn's output quality:

- **Goal progress**: read `ctx.goals` state change — did the active goal advance from `active` to `complete`, or stay `active`?
- **Tool call success rate**: from `tools/result` events in this turn, count successes vs. errors.
- **Guard triggers**: count `repeat-tool-reminder` activations (indicates the agent was stuck in a loop).
- **User feedback**: read `message-feedback` data for this turn's assistant messages.

### Output

A `TurnOutcome` struct:

```ts
interface TurnOutcome {
  turnId: string
  sessionId: string
  goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none'
  toolCallCount: number
  toolSuccessRate: number  // 0.0–1.0
  guardTriggerCount: number
  userFeedback: 'positive' | 'negative' | 'none'
  outcomeScore: number  // 0.0–1.0, weighted composite
  timestamp: number
}
```

### Key constraint

The evaluator is **read-only** — it observes turn output, does not modify agent behavior. This guarantees the deterministic loop is unaffected.

---

## Layer 2: Behavior Adapter

### Mount points

Three existing extension points:

| Extension point | What to inject | Source |
|---|---|---|
| `agent/pre-step` (waterfall) | Relevant historical experience summary as context | Experience Store records matching the current task pattern |
| `system-prompt/assemble` | Adapted behavioral preferences ("this user prefers concise answers", "this project commonly uses React patterns") | Preferences distilled from user feedback and task patterns |
| `agent/request` (waterfall) | Model/parameter selection based on historical success rate | Provider success-rate statistics grouped by task type |

### What it does

Before each step, retrieve experiences from the Experience Store whose context signature is similar to the current situation, and inject them as model-visible context. This is not code modification — it gives the model more information to make better decisions.

### Key constraint

Injected content is **advisory**, not mandatory. The model can heed or ignore it. This preserves agent flexibility.

### `agent/pre-step` injection format

```markdown
## Past Experience (advisory)

In similar situations before:
- **What worked**: <lesson from highest-scored matching experience>
- **What failed**: <lesson from lowest-scored matching experience>
- **Suggested approach**: <aggregated recommendation>

These are historical observations, not instructions. Use your judgment.
```

### `system-prompt/assemble` injection

A dynamically assembled section, ordered after static sections but before tool schemas. Content is a concise list of learned preferences:

```markdown
## Learned Preferences (advisory)

- User tends to prefer concise answers with code examples
- In this workspace, TypeScript is the primary language
- ripgrep-based search has historically been more efficient than glob for this project
```

---

## Layer 3: Experience Store

### Storage

Reuses `packages/session/` SQLite backend infrastructure. New `experiences` table in the same database.

### Schema

```sql
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,          -- ULID
  session_id TEXT NOT NULL,     -- source session
  turn_id TEXT NOT NULL,        -- source turn
  created_at INTEGER NOT NULL,  -- timestamp

  -- Context signature: task type + tool combination + workspace fingerprint
  context_hash TEXT NOT NULL,   -- for similarity matching
  task_pattern TEXT,            -- "refactoring" / "bugfix" / "feature" / etc.
  tools_used TEXT,              -- JSON array of tool names
  workspace_digest TEXT,        -- workspace file-tree digest

  -- Action record
  actions TEXT NOT NULL,        -- JSON: tool call sequence summary

  -- Outcome and lesson
  outcome_score REAL,           -- 0.0–1.0, composite score
  user_feedback TEXT,           -- "positive" / "negative" / "none"
  lesson TEXT,                  -- LLM-generated natural-language lesson

  -- Indexing
  tags TEXT,                    -- JSON array of tags
  confidence REAL DEFAULT 1.0,  -- decays with reuse unless re-validated
  reuse_count INTEGER DEFAULT 0 -- how many times this was injected
);

CREATE INDEX idx_experiences_context ON experiences(context_hash);
CREATE INDEX idx_experiences_task ON experiences(task_pattern);
CREATE INDEX idx_experiences_score ON experiences(outcome_score DESC);
```

### Retrieval

Context-signature fuzzy matching — weighted similarity of task pattern + tool combination + workspace digest. No vector database needed; SQLite FTS (already available via `session-query`) is sufficient.

### Eviction

Retain the most recent 1000 experiences, evicting by combined score of `outcome_score` and recency. Experiences with `outcome_score < 0.3` and `reuse_count == 0` are evicted first.

---

## Layer 4: Meta-Cognition Engine

### Mount point

`turn/end` session event (durable event, fires after a turn is fully closed). The reflection itself runs asynchronously during `agent.runMaintenance()`.

### What it does

When a turn is fully closed and all tool calls and user feedback are logged, call a low-cost LLM to generate a structured reflection:

```text
Input: this turn's tool call sequence + results + goal progress + guard triggers + user feedback
Output: {
  "what_worked": "...",
  "what_failed": "...",
  "what_to_try_differently": "...",
  "reusable_lesson": "..."  ← this gets written to Experience Store's lesson field
}
```

### Key constraints

- **Async**: triggered via `agent.runMaintenance()` during idle, does not consume normal turn token budget.
- **Low-cost model**: use `deepseek-chat` (not `deepseek-reasoner`) to control overhead.
- **Optional**: can be disabled via config; Layers 1–3 form a closed loop even without LLM reflection (they just lack the `lesson` field).

---

## Security Boundaries

| Risk | Mitigation |
|---|---|
| Learning layer pollutes deterministic loop | Learning layer only intervenes via advisory injection, never modifies loop code |
| Experience store grows unbounded | Retention window (latest 1000), eviction by outcome score + time decay |
| Reflection LLM call cost | Bound to `runMaintenance()`, only triggers on idle, uses low-cost model |
| Wrong experiences reinforced | Confidence decay — each experience's weight decreases with reuse count, unless re-validated by a new positive outcome |
| Dynamic plugin abuse | Learning outcomes primarily become system prompt sections and context injection, not dynamic plugins |
| Privacy leakage via stored experiences | Experience Store is local-only, same trust boundary as session logs; no telemetry export without explicit opt-in |

---

## Implementation Path (Phased)

### Phase 1 — Experience Store + Outcome Evaluator (minimal closed loop)

- Create new package `packages/core/experience/` (or `packages/learning/experience/`), implement SQLite storage.
- Mount outcome evaluator on `agent/turn-stopping`, write raw turn data to Experience Store.
- No LLM reflection yet, only objective data recording.
- **Deliverable**: a closed data-collection loop. Every turn's outcome is scored and stored.

### Phase 2 — Behavior Adapter

- Inject historical experience summary at `agent/pre-step`.
- Inject behavioral preferences at `system-prompt/assemble`.
- Use rule-based matching (not LLM) for context similarity retrieval.
- **Deliverable**: the agent sees its own past experience at the start of each step.

### Phase 3 — Meta-Cognition Engine

- Trigger LLM reflection at `turn/end` + `runMaintenance`.
- Generate `lesson` field, write to Experience Store.
- Introduce confidence decay mechanism.
- **Deliverable**: the agent reflects on its performance and extracts reusable lessons.

### Phase 4 — Adaptive Strategy Adjustment

- `agent/request` waterfall: model selection based on historical success rate.
- `tools/restrict`: tool recommendation based on historical usage patterns.
- Guard threshold auto-tuning: `repeat-tool-reminder` thresholds adapt based on observed loop frequency.
- **Deliverable**: the agent adapts its tooling and model routing based on accumulated experience.

---

## Compatibility with Existing Architecture

This design **does not modify the agent loop itself**. All intervention is through existing extension points (waterfall/serial events). This conforms to dsh's core design philosophy: "no single line modifies the loop itself" (`docs/cookbook/extension-cookbook.zh.md:99`).

The learning layer is a pure plugin. It can be unloaded at any time, and the agent returns to fully deterministic behavior. No session log format changes are needed — the Experience Store is a sidecar table, not part of the event log.

The biggest architectural decision is: **learning outcomes are injected as advisory context, not as config mutations**. This means the agent receives "suggestions" not "directives," preserving the LLM as the final decision-maker — the foundational principle of the dsh agent architecture.
