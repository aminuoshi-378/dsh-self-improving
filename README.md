# dsh-ai-enhancements

Two plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):

1. **dsh-self-improving** — cross-session learning layer: the agent learns from historical experience.
2. **dsh-rule-enforcement** — user rule injection: edit a markdown file to control agent behavior.

The two plugins can be used separately or together.

> 中文: [README.zh-CN.md](README.zh-CN.md)

---

## Prerequisites

- Node.js >= 22 (check with `node -v`)
- dsh installed and configured with an LLM provider

---

## dsh-self-improving — Cross-Session Learning

After each task, the agent scores the turn, stores it in an experience database, and injects relevant experiences into the next task.

### Install into dsh

#### Option 1: Tarball install (recommended for production)

Suitable for normal use. After installation the plugin appears in WebUI → Settings → Plugins.

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving
pnpm install
pnpm run build

# 2. Pack into a tarball
pnpm pack    # generates dsh-self-improving-0.1.0.tgz

# 3. Install into dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
```

> After the repo is updated you must re-run `pnpm run build && pnpm pack` and reinstall the tarball.

#### Option 2: Link install (recommended for development)

Suitable for development. After changing code you only need to rebuild and reinstall.

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving
pnpm install
pnpm run build

# 2. Edit ~/.dsh/profiles/web/package.json and switch the dependency from tarball to link:
#    Find the "dsh-self-improving" line and change it to:
#    "dsh-self-improving": "link:/absolute/path/to/dsh-self-improving"

# 3. Reinstall dependencies (allow lockfile update)
cd ~/.dsh/profiles/web
CI=true pnpm install --no-frozen-lockfile
```

> Link-installed plugins also appear in the WebUI plugin list.

> Development workflow: change code → `pnpm run build` → `cd ~/.dsh/profiles/web && CI=true pnpm install --no-frozen-lockfile` → restart dsh web

### Verify

```bash
cd /path/to/deepseek-harness

# Run the first task (accumulate experience)
dsh --profile web "create a file called hello.js"
```

stderr output:
```
[self-improving] plugin loaded
[self-improving] tool/result — write OK
[self-improving] turn 1 scored — score=0.78 | goal=advanced tools=1 successRate=1.00 steps=1 efficiency=1.00 difficulty=low
```

Run a second task and you will see experience injection (P0: once per turn):
```
[self-improving] agent/pre-step — turn=2 step=1 (injecting)
[self-improving] injecting 1 past experiences into pre-step (best score 0.78)
```

### Configuration

The default configuration works out of the box. To override, edit `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: self-improving
  config:
    dbPath: '~/.dsh/experiences.db'    # Path to the experience DB; must be a file path for cross-session persistence
    metaCognitionEnabled: true         # Enable reflection / lesson extraction
    behaviorAdapterEnabled: true       # Enable experience injection
    minInjectionScore: 0.3             # Only inject experiences with score >= 0.3
    # Experience injection budget
    maxInjectionChars: 8000            # Max characters of lesson text injected per turn
    # Meta-cognition queue
    maxPendingReflections: 100         # Max pending reflections before dropping oldest
    # Experience store generational GC limits
    youngGenMax: 200                   # Max records in young generation
    oldGenMax: 800                     # Max records in old generation
    lessonMergeThreshold: 20           # Merge similar lessons when unmerged count reaches this
    experienceTtlDays: 30              # Old-gen experiences not reused in N days are downgraded
    forgetScoreThreshold: 0.3          # Active-forgetting score threshold
    forgetConfidenceThreshold: 0.2     # Active-forgetting confidence threshold
    # Phase 6 adaptive strategies (optional, disabled by default)
    adaptiveModelEnabled: false        # Switch model based on historical task-type success rate
    strongModel: ''                    # Strong reasoning model id (e.g. deepseek-reasoner); disabled if empty
    standardModel: ''                  # Standard model id (e.g. deepseek-chat)
    adaptiveToolGuardEnabled: false    # Deny tools that repeatedly appear in failed experiences
    failedToolDenyThreshold: 3         # Deny a tool that appears in N failed experiences
```

#### Built-in policies (no configuration required)

- **P0 experience deduplication**: identical tool sequences keep only the newest record.
- **P0 once-per-turn injection**: experiences are injected only at the first step of a turn.
- **P0 step-efficiency scoring**: fewer steps score higher; 2 steps = 0.95, 10 steps = 0.55.
- **P0 task-difficulty tiers**: high-difficulty (7+ steps or any failure) experiences are prioritized; low (1–2 steps, all success) is only used as filler.
- **P1 implicit negative feedback**: user abort/correction is automatically treated as negative feedback without requiring explicit thumbs up/down.
- **P2 lesson merging**: similar lessons are automatically merged after accumulating 20 unmerged lessons.
- **P3 generational experience management**: young generation (200 records) + old generation (800 records) dual-region GC.
- **P4 two-stage recall**: coarse SQL filter + fine-grained composite-score reranking.
- **P5 task-type classification**: task pattern inferred from user message (bugfix/feature/refactoring/search/test-writing/general); same type prioritized.
- **P5 WebUI experience panel**: install the GUI plugin and view stats, import/export in Settings → Plugins → Experiences.
- **Phase 6 adaptive model selection** (requires `adaptiveModelEnabled` + `strongModel`): switch between standard and strong model based on historical task-type average score.
- **Phase 6 adaptive tool guard** (requires `adaptiveToolGuardEnabled`): automatically deny tools that repeatedly appear in failed experiences.

### Install the WebUI experience panel (optional)

```bash
cd dsh-self-improving/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # generates dsh-self-improving-gui-0.1.0.tgz
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-gui-0.1.0.tgz
```

Restart dsh web, then view stats and import/export in Settings → Plugins → Experiences.

> Link install: add `"dsh-self-improving-gui": "link:/absolute/path/to/dsh-self-improving/gui"` to `~/.dsh/profiles/web/package.json`, then `cd ~/.dsh/profiles/web && CI=true pnpm install --no-frozen-lockfile`.

### Local development and testing

```bash
cd dsh-self-improving
pnpm install          # install dependencies
pnpm test             # run 119 unit tests (8 test files)
pnpm run benchmark    # run simulated A/B benchmark, generates benchmark-report.html
```

Run individual test files:

```bash
pnpm run test:store      # experience store (14 tests)
pnpm run test:evaluator  # outcome evaluator (8 tests)
pnpm run test:adapter    # behavior adapter (11 tests)
pnpm run test:meta       # meta-cognition engine (11 tests)
pnpm run test:memory     # memory benchmark (15 tests)
pnpm run test:advanced   # advanced features A1-B2 + T4 (30 tests)
pnpm run test:adaptive   # adaptive strategies Phase 6 (11 tests)
pnpm run test:event      # event parsing compatibility (9 tests)
```

---

## dsh-rule-enforcement — User Rule Injection

Edit `~/.dsh/rules.md` to add rules; they are automatically injected into the agent system prompt. Changes take effect immediately without restart.

### Install into dsh

#### Option 1: Tarball install (recommended for production)

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build
pnpm pack    # generates dsh-rule-enforcement-0.1.4.tgz

# 2. Install into dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz
```

#### Option 2: Link install (recommended for development)

```bash
# 1. Clone and build
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build

# 2. Edit ~/.dsh/profiles/web/package.json and change to:
#    "dsh-rule-enforcement": "link:/absolute/path/to/dsh-self-improving/dsh-rule-enforcement"

# 3. Reinstall dependencies (allow lockfile update)
cd ~/.dsh/profiles/web
CI=true pnpm install --no-frozen-lockfile
```

### Install the WebUI rule editor (optional)

```bash
cd dsh-rule-enforcement/src/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # generates dsh-rule-enforcement-gui-0.1.3.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-gui-0.1.3.tgz
```

Restart dsh web, then edit rules in Settings → Plugins → Rules.

### Edit rules

Edit the file `~/.dsh/rules.md` directly:

```markdown
# Project rules

- Reply in Chinese when the user asks in Chinese
- Update CHANGELOG before committing
- New files should use TypeScript
- Run security checks before git push
```

Or edit via the WebUI. Save and the rules take effect on the next agent request.

### Local development and testing

```bash
cd dsh-rule-enforcement
pnpm install
pnpm run typecheck    # type check
pnpm test             # run 10 tests
```

---

## Install all together

### Tarball

```bash
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-gui-0.1.0.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-gui-0.1.3.tgz
dsh --profile web
```

### Link

Edit `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": {
    "dsh-self-improving": "link:/path/to/dsh-self-improving",
    "dsh-self-improving-gui": "link:/path/to/dsh-self-improving/gui",
    "dsh-rule-enforcement": "link:/path/to/dsh-self-improving/dsh-rule-enforcement",
    "dsh-rule-enforcement-gui": "link:/path/to/dsh-self-improving/dsh-rule-enforcement/src/gui"
  }
}
```

```bash
cd ~/.dsh/profiles/web
CI=true pnpm install --no-frozen-lockfile
dsh --profile web
```

---

## FAQ

**`better-sqlite3` error during install?**
Add `allowBuilds: { better-sqlite3: true }` to `~/.dsh/profiles/web/pnpm-workspace.yaml`, then reinstall.

**Plugin not showing in WebUI plugin list?**
Make sure the plugin is declared in `~/.dsh/profiles/web/package.json` dependencies (link or tarball), registered in `dsh.profile.bundles`, and restart dsh web.

**`dbPath` says directory does not exist?**
The plugin automatically expands `~` and creates directories. If it still fails, run `mkdir -p ~/.dsh` manually.

**Tarball install shows type stripping error?**
You must run `pnpm run build` to compile `.ts` → `.js` before packing, and make sure the `dist/` directory exists.

**`duplicate loader entry id`?**
The same plugin is being loaded twice. Make sure there is no plugin with the same name in the dsh repo `packages/` directory, or its `package.json` has no `dsh` field.

**Link install changes not taking effect?**
After changing code, rebuild: `pnpm run build`, then reinstall in the profile directory: `cd ~/.dsh/profiles/web && CI=true pnpm install --no-frozen-lockfile`.

---

## More documentation

- [Architecture design](docs/design.md) — four-layer architecture, P0-P5 implementation details, safety boundaries, roadmap
- [TODO](todo.md) — P0-P5 completion status and future plans
- [Changelog](CHANGELOG.md)
