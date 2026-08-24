# dsh-ai-enhancements

Plugin packs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — a suite of optional, independently-mountable dsh plugins organized as two packs:

1. **[`dsh-self-improving/`](#1-dsh-self-improving--cross-session-learning)** — a cross-session **learning layer**.
2. **[`dsh-rule-enforcement/`](#2-dsh-rule-enforcement--user-rules)** — a user **rules** engine.

Each pack can be mounted **standalone** or **together**.

> Docs: [Design](docs/design.md) · [Plugin Dev Notes](docs/plugin-dev-notes.md) · [CHANGELOG](CHANGELOG.md)
> 中文版：[README.zh-CN.md](README.zh-CN.md)

---

## Prerequisites

- [Node.js](https://nodejs.org/) **>= 22** (use `nvm use 22` or install Node 22 LTS)
- [pnpm](https://pnpm.io/) (comes with Node via corepack)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) installed and working
- A configured LLM provider in `~/.dsh/settings.yaml` (e.g. qwen, deepseek)

```bash
# Verify Node version
node -v   # must be >= 22

# Verify dsh works
cd /path/to/deepseek-harness
dsh --profile headless "say hello"
```

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

#### Option A: Install as a pre-built tarball (recommended)

This method lets the WebUI plugin manager list and manage the plugin.

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving
npm install
npm run build

# 2. Compile the dsh adapter (TypeScript → JavaScript)
#    The dsh runtime plugin is at packages/learning/self-improving/ in the dsh repo.
#    If you have the dsh repo locally, the plugin source is already there.
#    Compile it:
cd /path/to/deepseek-harness/packages/learning/self-improving
npx tsc src/index.ts --outDir dist \
  --module ESNext --moduleResolution bundler --target ES2022 \
  --strict --esModuleInterop --skipLibCheck --ignoreConfig

# 3. Pack into a tarball (from the plugin directory)
pnpm pack    # produces dsh-self-improving-0.1.0.tgz

# 4. Install into a dsh profile
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz

# 5. If pnpm warns about ignored build scripts for better-sqlite3:
#    Edit ~/.dsh/profiles/web/pnpm-workspace.yaml, set:
#      allowBuilds:
#        better-sqlite3: true
#    Then reinstall:
dsh plugin --profile web remove dsh-self-improving
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
```

After installation, the plugin appears in **WebUI → Settings → Plugins**.

#### Option B: Build from source (for development)

Clone the repo into dsh's workspace and use it as a workspace package:

```bash
# 1. Clone the repo
git clone https://github.com/aminuoshi-378/dsh-self-improving.git

# 2. Copy the plugin into dsh's packages directory
cp -r dsh-self-improving /path/to/deepseek-harness/packages/learning/self-improving

# 3. Add better-sqlite3 to dsh's pnpm-workspace.yaml allowBuilds
#    Edit deepseek-harness/pnpm-workspace.yaml:
#      allowBuilds:
#        better-sqlite3: true

# 4. Install deps in dsh
cd /path/to/deepseek-harness
pnpm install

# 5. The plugin auto-loads via the packages/*/* glob.
#    To make it a dsh bundle (auto-mount), ensure its package.json has:
#      "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
#    To avoid duplicate loading when also installed as a tarball,
#    remove the "dsh" key from the workspace package.json.
```

### Mount config

The tarball's `cordis.patch.yml` auto-mounts the plugin. If you need to override config, add to your profile's `cordis.patch.yml`:

```yaml
- id: self-improving
  config:
    dbPath: '~/.dsh/experiences.db'    # persistent storage (cross-session)
    metaCognitionEnabled: true          # enable LLM reflection (Layer 4)
    behaviorAdapterEnabled: true        # enable experience injection (Layer 2)
    minInjectionScore: 0.3              # only inject experiences with score >= 0.3
```

**Important:** `dbPath` must use `~/.dsh/experiences.db` (a file path) for cross-session persistence. Using `:memory:` means experiences are lost on restart.

### Verify it works

After installing, run a task and check stderr for `[self-improving]` logs:

```bash
cd /path/to/deepseek-harness

# First task — builds experience
dsh --profile web "create a file called hello.js"
```

Expected output on stderr:
```
[self-improving] plugin loaded {"dbPath":"~/.dsh/experiences.db",...}
[self-improving] agent/pre-step fired — turn=1 step=1
[self-improving] tool/result — write OK
[self-improving] agent/turn-stopping fired — turn=1
[self-improving] turn 1 scored — score=0.78 tools=1 successRate=1.00
```

Run a **second** task — experience from the first run should be injected:
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

#### Option A: Install as a pre-built tarball (recommended)

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build
pnpm pack    # produces dsh-rule-enforcement-0.1.4.tgz

# 2. Install into a dsh profile
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz
```

After installation, the plugin appears in **WebUI → Settings → Plugins**.

#### Option B: Build from source (for development)

```bash
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build
cp -r . /path/to/deepseek-harness/packages/rule-enforcement/
cd /path/to/deepseek-harness
pnpm install
```

### WebUI editor (optional)

The Rules editor lives in a separate GUI plugin:

```bash
cd dsh-rule-enforcement/src/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # produces dsh-rule-enforcement-gui-0.1.3.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-gui-0.1.3.tgz
```

After restarting `dsh web`, edit rules at Settings → Plugins → **Rules**.

### Mount config

The tarball's `cordis.patch.yml` auto-mounts the plugin. No manual config needed.

### Rules file

The rules file is at `~/.dsh/rules.md`. Edit it directly or via the WebUI:

```markdown
# Project Rules

- Reply in Chinese when the user writes in Chinese
- Update CHANGELOG before committing
- Use TypeScript for all new files
```

Rules are injected into the system prompt via `systemPrompt.section()` (order 200, after persona). They appear in every LLM request across all agent presets.

### Development

```bash
cd dsh-rule-enforcement
pnpm install
pnpm run typecheck
pnpm test
```

---

## Combined install

Both packs coexist in the same profile. Install both as tarballs:

```bash
cd /path/to/deepseek-harness

# Install both plugins
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz

# Start dsh web
dsh --profile web
```

Both plugins appear in **WebUI → Settings → Plugins** and can be enabled/disabled independently.

---

## Troubleshooting

### `duplicate loader entry id: self-improving`

The same plugin is loaded twice — once as a workspace package and once as a tarball. Fix: remove the `dsh.bundle` field from the workspace package's `package.json`, or remove the workspace package from `packages/` entirely.

### `Cannot open database because the directory does not exist`

The `dbPath` with `~/` is not expanded. The plugin code handles `~` expansion, but if you see this error, ensure `~/.dsh/` directory exists: `mkdir -p ~/.dsh`.

### `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`

The tarball contains `.ts` files instead of compiled `.js`. Fix: run `tsc` to compile `src/index.ts` → `dist/index.js` before `pnpm pack`, and ensure `package.json` has `"main": "dist/index.js"` and `"files": ["dist", ...]`.

### `ignored build scripts: better-sqlite3`

pnpm blocked the native build. Fix: add `allowBuilds: { better-sqlite3: true }` to the profile's `pnpm-workspace.yaml`, then reinstall.

### Plugin not visible in WebUI plugin list

The plugin must be installed via `dsh plugin --profile web add <tarball>` (not as a `link:` workspace package). Workspace packages are not shown in the WebUI plugin manager.

### `agent/turn-stopping` not firing

In headless mode (`dsh --profile headless`), the `turn-stopping` event fires after the turn completes. If you don't see `[self-improving] turn N scored` logs, ensure the plugin loaded (check for `plugin loaded` log on stderr).
