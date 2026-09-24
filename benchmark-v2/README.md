# benchmark-v2 — usefulness-over-use benchmark for dsh-self-improving

Measures whether the `dsh-self-improving` plugin makes a dsh agent **more useful as it is used** —
with a REAL agent (dsh WebUI + a real LLM), never a simulator. You can watch every run live
in the visible browser window.

## Why v2 (replaces `benchmark/`)

The old benchmark graded a `SimAgent` whose "with experience the mistake probability drops"
assumption produced the very improvement it reported (circular). v2 contains no simulator:
every number comes from a real dsh session, and every verdict comes from `node test.cjs` exit codes.

## Protocol

- **Task suite**: 20 small Node tasks in 5 families (unicode, date, json, async, file),
  3 sequence tasks + 1 held-out task each. Family order is interleaved
  (`u1 d1 j1 a1 f1 | u2 d2 ... | held-out last`). Within a family, later tasks reuse the
  same domain lesson (surrogate pairs, UTC arithmetic, dot-key JSON, promise semantics,
  atomic file ops) — that is the transferable "experience" the plugin should accumulate.
- **Arms** (fixed order, same tasks, same model):
  - `baseline` — no plugin loaded (`bench-v2-web-baseline`, port 3081)
  - `enabled` — plugin loaded (`bench-v2-web-enabled`, port 3082) with a **bench-owned
    SQLite store** (`benchmark-v2/state/enabled.db`, reset per run). The production
    `~/.dsh/experiences.db` is never read or written.
- **Isolation (arena protocol)**: all tasks run in ONE registered workspace
  (`state/arena/`), fully wiped and re-seeded before every task — the agent never sees
  another task's files or leftovers. Each task runs in its own fresh session.
  The arena is registered directly in `~/.dsh/storages/workspace.json`
  (a native macOS directory chooser cannot be driven by automation).
- **Determinism**: both arms pin `agent-default-model` to the same model
  (the one configured in `config.json` via the configured provider) and the same persona;
  the runner refuses to send if the UI model selector shows anything else.
- **Contamination guards**: `prepare` verifies via `dsh --dump-config` that the plugin row is
  present (enabled) / absent (baseline); after each arm the server log is checked for
  `[self-improving] plugin loaded` markers appearing in the correct arm only.

## Metrics

Per run (append to `runs/<tag>/runs.jsonl`): pass/fail (`node test.cjs`), wall duration,
tokens (input/output/cache-read parsed from the workspace's session JSONL via zstd),
turns, tool calls, UI screenshot, plus experience-store stats (entries / lessons / confidence)
for the enabled arm.

Report (`node src/run.mjs report`) aggregates:
- per-task A/B verdicts and deltas
- per-family pass sequence by in-family position (1→3) — the learning-curve signal
- held-out transfer (enabled-with-evolved-store vs baseline on never-seen tasks)
- **negative transfer**: tasks where enabled fails but baseline passed (bad/stale lessons)

## Usage

```sh
node src/run.mjs prepare        # build plugin (tsc), write+verify bench profiles, reset bench db
node src/run.mjs verify-seeds   # authoring check: seed FAILS test, reference solution PASSES
node src/run.mjs smoke          # 2 tasks x 2 arms end-to-end, visible browser
node src/run.mjs run --arm baseline            # full baseline arm (20 tasks)
node src/run.mjs run --arm enabled             # full enabled arm (20 tasks, fresh bench db)
node src/run.mjs report         # aggregate latest run into report.md / report.json
```

Recommended full run: `prepare` → `run --arm baseline` → `run --arm enabled --tag <same-tag>`
→ `report --tag <same-tag>` (use the same `--tag` to land both arms in one report).
Cost: 2 arms x 20 tasks = 40 real LLM sessions.

**Manual operation mode** (proven in runs/manual-smoke, 4/4 PASS): a human or an
agent-with-browser-tools drives the visible WebUI step by step (seed arena → new session →
send prompt → machine-grade), while the runner handles only servers/seeding/grading/report.
This mode is immune to UI language switches and dialog quirks that break brittle scripts.

## Machine assumptions

- `pnpm exec dsh` works from the deepseek-harness repo; profiles live in `~/.dsh/profiles`.
- The LLM provider endpoint configured in `config.json` is reachable for the pinned model.
- `zstd` and `sqlite3` CLIs are on PATH (session log decompression, experience stats).
- Date tasks assume a non-UTC machine TZ (that is part of what they test).
- Playwright resolves through `node_modules` symlinks to the verified
  `run.playwrightModuleDir` installation (1.62.1 + bundled chromium).

## Authoring rules

- Task seeds and tests live in `tasks/<family>/<id>/`; reference fixes in `solutions/` are
  NEVER copied into workspaces — they exist so `verify-seeds` can prove each test is
  fail-able and pass-able without any agent.
- Tasks must stay dependency-free (plain Node) and deterministic on this machine.
- All grading is exit-code based; never add LLM-judged scoring.
