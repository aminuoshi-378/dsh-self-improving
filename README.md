# dsh-ai-enhancements

Plugin packs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — a suite of optional, independently-mountable dsh plugins organized as two packs:

1. **[`dsh-self-improving/`](#1-dsh-self-improving--cross-session-learning)** — a cross-session **learning layer**.
2. **[`dsh-rule-enforcement/`](#2-dsh-rule-enforcement--user-rules)** — a user **rules** engine.

Each pack can be mounted **standalone** or **together**.

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

### Install

There are two ways to install this plugin into dsh.

#### Option A: Build from source (recommended for development)

Clone the repo and copy the plugin into dsh's workspace:

```bash
# 1. Clone the repo
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving

# 2. Install deps and build
npm install
npm run build

# 3. Copy the plugin into dsh's packages directory
cp -r . /path/to/deepseek-harness/packages/learning/self-improving/

# 4. Add better-sqlite3 to dsh's pnpm-workspace.yaml allowBuilds
#    Edit deepseek-harness/pnpm-workspace.yaml, add:
#    allowBuilds:
#      better-sqlite3: true

# 5. Install deps in dsh
cd /path/to/deepseek-harness
pnpm install

# 6. Add to your profile's cordis.patch.yml (see Mount config below)
```

#### Option B: Install as a pre-built tarball

Build the tarball from source, then install via `dsh plugin`:

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving
npm install
npm run build

# 2. Pack into a tarball
npm pack    # produces dsh-self-improving-0.1.0.tgz

# 3. Install into a dsh profile
cd /path/to/deepseek-harness
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-self-improving-0.1.0.tgz

# 4. If pnpm fails on better-sqlite3, add to pnpm-workspace.yaml:
#    allowBuilds:
#      better-sqlite3: true
#    Then run: pnpm install
```

### Mount config

Add to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: self-improving
      name: dsh-self-improving
      config:
        dbPath: ~/.dsh/experiences.db    # persistent storage (cross-session)
        metaCognitionEnabled: true        # enable LLM reflection (Layer 4)
        behaviorAdapterEnabled: true      # enable experience injection (Layer 2)
        minInjectionScore: 0.3            # only inject experiences with score >= 0.3
```

### Verify it works

After installing, run a task and check stderr for `[self-improving]` logs:

```bash
cd /path/to/deepseek-harness
dsh --profile <your-profile> "create a file called hello.js"
```

You should see:
```
[self-improving] plugin loaded {"dbPath":"~/.dsh/experiences.db",...}
[self-improving] agent/pre-step fired — turn=1 step=1
[self-improving] tool/result — write OK
[self-improving] agent/turn-stopping fired — turn=1
[self-improving] turn 1 scored — score=0.78 tools=1 successRate=1.00
```

Run a **second** task — you should see experience injection:
```
[self-improving] injecting 1 past experiences into pre-step (best score 0.78)
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

## 2. `dsh-rule-enforcement/` — User rules injection

A minimal plugin: injects **a markdown file** (`~/.dsh/rules.md`) into the agent's system prompt as **mandatory rules** the model must follow.

- Rules stored in `~/.dsh/rules.md` — a plain markdown file, easy to git-track and diff
- Edit via WebUI (Settings → Rules tab) or any text editor
- Changes take effect **live** (no restart needed)
- Uses `systemPrompt.section()` for injection into the system prompt

### Install

#### Option A: Build from source (recommended for development)

```bash
# 1. Clone the repo
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement

# 2. Install deps and build
pnpm install
pnpm run build

# 3. Copy into dsh or use as a workspace package
cp -r . /path/to/deepseek-harness/packages/rule-enforcement/

# 4. Install deps in dsh
cd /path/to/deepseek-harness
pnpm install
```

#### Option B: Install as a pre-built tarball

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build
pnpm pack    # produces dsh-rule-enforcement-0.1.4.tgz

# 2. Install into a dsh profile
cd /path/to/deepseek-harness
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz
```

### WebUI editor (optional)

The Rules editor lives in a separate GUI plugin:

```bash
cd dsh-rule-enforcement/src/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # produces dsh-rule-enforcement-gui-0.1.3.tgz
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-rule-enforcement-gui-0.1.3.tgz
```

After restarting `dsh web`, edit rules at Settings → Plugins → **Rules**.

### Mount config

Add to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-rule-enforcement
      name: dsh-rule-enforcement
      config: {}
```

### Rules file

The rules file is at `~/.dsh/rules.md`. Edit it directly or via the WebUI:

```markdown
# Project Rules

- Reply in Chinese when the user writes in Chinese
- Update CHANGELOG before committing
- Use TypeScript for all new files
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

Both packs coexist in the same profile — just insert both:

```yaml
- insert:
    - id: self-improving
      name: dsh-self-improving
      config:
        dbPath: ~/.dsh/experiences.db
        metaCognitionEnabled: true
        behaviorAdapterEnabled: true
        minInjectionScore: 0.3
    - id: dsh-rule-enforcement
      name: dsh-rule-enforcement
      config: {}
```
