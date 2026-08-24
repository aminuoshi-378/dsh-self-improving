# dsh-ai-enhancements

Two plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):

1. **dsh-self-improving** — cross-session learning layer; agents learn from past experience
2. **dsh-rule-enforcement** — user rule injection; edit a markdown file to control agent behavior

Each plugin works standalone or together with the other.

> 中文: [README.zh-CN.md](README.zh-CN.md)

---

## Prerequisites

- Node.js >= 22 (check with `node -v`; `better-sqlite3@12` prebuilts cover Node 22–24)
- dsh installed and configured with an LLM provider

---

## dsh-self-improving — cross-session learning

The agent scores itself after every task and stores the experience. On the next task it injects the most relevant past experiences for reference.

### Install into dsh

```bash
# 1. Clone this repository
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving

# 2. Install deps and compile
pnpm install
pnpm run build

# 3. Pack into a tarball
pnpm pack    # produces dsh-self-improving-0.1.0.tgz

# 4. Install into dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
```

After install you can see and manage the plugin under WebUI (Settings → Plugins).

If install reports that the `better-sqlite3` build was skipped, edit `~/.dsh/profiles/web/pnpm-workspace.yaml` and add:

```yaml
allowBuilds:
  better-sqlite3: true
```

Then reinstall:

```bash
dsh plugin --profile web remove dsh-self-improving
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
```

### Verify

```bash
cd /path/to/deepseek-harness

# Run the first task (accumulate experience)
dsh --profile web "create a file called hello.js"
```

stderr should output:
```
[self-improving] plugin loaded
[self-improving] tool/result — write OK
[self-improving] turn 1 scored — score=0.78
```

Run a second task and you should see experience injection:
```
[self-improving] injecting 1 past experiences into pre-step (best score 0.78)
```

### Configure

The default config works out of the box. To tweak it, override in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: self-improving
  config:
    dbPath: '~/.dsh/experiences.db'    # experience store path; must be a file path to persist across sessions
    metaCognitionEnabled: true        # whether to reflect (extract lessons learned)
    behaviorAdapterEnabled: true      # whether to inject past experiences
    minInjectionScore: 0.3            # only inject experiences scored >= 0.3
```

### Local dev tests

```bash
cd dsh-self-improving
pnpm install          # install deps
pnpm test             # run 29 unit tests
pnpm run benchmark    # run a simulated A/B benchmark, producing benchmark-report.html
```

---

## dsh-rule-enforcement — user rule injection

Edit `~/.dsh/rules.md` to write rules; they are injected into the agent's system prompt automatically. Changes take effect immediately, no restart needed.

### Install into dsh

```bash
# 1. Clone this repository
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement

# 2. Install deps and compile
pnpm install
pnpm run build

# 3. Pack into a tarball
pnpm pack    # produces dsh-rule-enforcement-0.1.4.tgz

# 4. Install into dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz
```

### Install the WebUI editing panel (optional)

```bash
cd dsh-rule-enforcement/src/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # produces dsh-rule-enforcement-gui-0.1.3.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-gui-0.1.3.tgz
```

After install, restart dsh web and edit rules under Settings → Plugins → Rules.

### Edit rules

Edit `~/.dsh/rules.md` directly:

```markdown
# Project rules

- Reply in Chinese when the user asks in Chinese
- Update the CHANGELOG before committing
- Write new files in TypeScript
- Run a security review before git push
```

Or edit through the WebUI. Save and it takes effect on the next agent request.

### Local dev tests

```bash
cd dsh-rule-enforcement
pnpm install
pnpm run typecheck    # type check
pnpm test             # run 10 tests
```

---

## Install both plugins

```bash
cd /path/to/deepseek-harness

dsh plugin --profile web add /absolute/path/to/dsh-self-improving-0.1.0.tgz
dsh plugin --profile web add /absolute/path/to/dsh-rule-enforcement-0.1.4.tgz

dsh --profile web
```

The two plugins do not interfere with each other and can be enabled/disabled independently in the WebUI plugin list.

---

## FAQ

**`better-sqlite3` build error during install (e.g. `ECONNRESET`, `gyp ERR! find VS`)?**
Usually two causes:
- `better-sqlite3` fetches its prebuilt binary from GitHub, which may be unreachable. The project ships `.npmrc` pointing `prebuild-install` at the npmmirror mirror, so a normal `pnpm install / pnpm run build` already works. If you removed `.npmrc`, restore it or set `better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary`.
- An old `better-sqlite3@11` has **no prebuilt binary for Node 24** and falls back to a local `node-gyp` compile (needs VS C++ workload). The project pins `better-sqlite3@^12`, which ships Node 24 prebuilds. Keep the pinned version; don't downgrade to v11.

**Plugin not showing in the WebUI plugin list?**
A plugin only appears in the WebUI when installed via `dsh plugin add <tarball>`. A workspace (`link:`) approach will not show it.

**`dbPath` reports the directory does not exist?**
The plugin creates `~/.dsh/` automatically. If it still fails, run `mkdir -p ~/.dsh` manually.

**Type-stripping error when installing a tarball?**
Run `pnpm run build` first to compile `.ts` → `.js`, and make sure the `dist/` directory exists.

**`duplicate loader entry id`?**
The same plugin is loaded twice. Make sure there is no plugin with the same name under the dsh repo's `packages/` directory, or that its `package.json` has no `dsh` field.

---

## More docs

- [Architecture design](docs/design.md) — four-layer architecture, security boundaries, implementation path
- [Plugin dev notes](docs/plugin-dev-notes.md) — dsh plugin development practices and pitfalls
- [Changelog](CHANGELOG.md)

