#!/usr/bin/env node
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { basename, join } from 'node:path'
import { ROOT, loadConfig } from './lib/config.mjs'
import { loadManifest, taskById, seedArena, seedWorkspace, gradeWorkspace, solutionFile, seedDir } from './lib/tasks.mjs'
import { ensureProfiles, verifyProfiles } from './lib/profiles.mjs'
import { startServer, killTree, checkPluginMarkers } from './lib/server.mjs'
import { launchBrowser, runTaskInUi } from './lib/ui.mjs'
import { extractMetrics, experienceStats } from './lib/metrics.mjs'
import { buildReport } from './lib/report.mjs'

const cfg = loadConfig()

const usage = () => {
  console.log(`Usage:
  node src/run.mjs prepare                 build plugin, create bench profiles, reset bench db
  node src/run.mjs verify-seeds            every task: seed FAILS its test, reference solution PASSES
  node src/run.mjs run --arm baseline|enabled [--tasks u1,d1] [--tag <name>]
  node src/run.mjs smoke                   1 train + 1 test (enabled) + 1 test (baseline), visible browser
  node src/run.mjs report [--tag <name>]   aggregate the latest run dir (or --tag) into report.md`)
}

const parseArgs = (argv) => {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arm') flags.arm = argv[++i]
    else if (argv[i] === '--tasks') flags.tasks = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (argv[i] === '--tag') flags.tag = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return flags
}

const resetBenchDb = () => {
  for (const suffix of ['', '-wal', '-shm']) {
    const db = `${cfg.dbPath}${suffix}`
    if (existsSync(db)) rmSync(db)
  }
}

/** 0.1.7 scans/resumes the workspace's stored sessions at boot; an arena
 * directory of interrupted bench sessions wedges the boot pipeline for
 * minutes before the token URL prints (observed: 337 files -> >300s,
 * empty -> 2s). Every bench boot must start from an empty session store. */
const clearArenaSessions = () => {
  const dir = join(cfg.dshHome, 'sessions', `--${cfg.arenaPath.split('/').filter(Boolean).join('-')}--`)
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true })
}

function prepare() {
  console.log('[1/3] building plugin (tsc)...')
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: cfg.pluginProject, encoding: 'utf8' })
  if (build.status !== 0) throw new Error(`plugin build failed:\n${(build.stderr ?? '').slice(0, 2000)}`)
  console.log('[2/3] writing bench profiles...')
  ensureProfiles(cfg)
  console.log('[3/3] verifying composed profiles...')
  const problems = verifyProfiles(cfg)
  if (problems.length) {
    console.error('profile verification FAILED:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  resetBenchDb()
  registerArenaWorkspace()
  console.log('prepare OK: profiles verified, bench db reset, arena registered')
}

/**
 * Register the arena directory in dsh's workspace registry
 * (~/.dsh/storages/workspace.json). Idempotent; call while no server is running.
 */
function registerArenaWorkspace() {
  mkdirSync(cfg.arenaPath, { recursive: true })
  const registryPath = join(cfg.dshHome, 'storages', 'workspace.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const existing = Object.values(registry.tables.workspaces).find((w) => w.path === cfg.arenaPath)
  if (existing) {
    console.log(`arena workspace already registered (${existing.title})`)
    return
  }
  const id = randomUUID()
  const now = new Date().toISOString()
  registry.tables.workspaces[id] = { path: cfg.arenaPath, title: basename(cfg.arenaPath), sessionIds: [], createdAt: now, updatedAt: now }
  registry.global.workspaceIds.push(id)
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
  console.log(`arena workspace registered: ${id} (${cfg.arenaPath})`)
}

function verifySeeds() {
  const manifest = loadManifest()
  let failures = 0
  for (const task of manifest.tasks) {
    const tmp = mkdtempSync(join('/tmp', 'seed-'))
    try {
      seedWorkspace(task, join(tmp, 'w'))
      const seedGrade = gradeWorkspace(join(tmp, 'w'))
      const fixed = join(tmp, 'f')
      mkdirSync(fixed)
      copyFileSync(join(seedDir(task), 'test.cjs'), join(fixed, 'test.cjs'))
      const solutionDir = join(ROOT, 'solutions', task.family, task.id)
      if (existsSync(solutionDir)) {
        // Multi-file solution: a directory of modules mirroring the seed layout.
        for (const file of readdirSync(solutionDir)) {
          if (file.endsWith('.cjs') || file.endsWith('.js')) copyFileSync(join(solutionDir, file), join(fixed, file))
        }
      } else {
        copyFileSync(solutionFile(task), join(fixed, 'bug.cjs'))
      }
      const solutionGrade = gradeWorkspace(fixed)
      const ok = !seedGrade.pass && solutionGrade.pass
      if (!ok) failures++
      console.log(`${ok ? 'OK  ' : 'BAD '} ${task.id}: seed ${seedGrade.pass ? 'PASSES (invalid)' : 'fails'} / solution ${solutionGrade.pass ? 'passes' : `FAILS: ${solutionGrade.stdout || solutionGrade.stderr}`}`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
  if (failures) {
    console.error(`verify-seeds FAILED for ${failures} task(s)`)
    process.exit(1)
  }
  console.log(`verify-seeds OK: all ${manifest.tasks.length} tasks valid (seed fails, solution passes)`)
}

/**
 * One server-backed phase: boot the profile, drive every task through the
 * visible WebUI, machine-grade, and append one runs.jsonl row per task.
 */
async function runPhase({ resultArm, profileArm, phase, tasks, runDir }) {
  const shotsRoot = join(runDir, 'shots')
  mkdirSync(shotsRoot, { recursive: true })
  const arena = cfg.arenaPath
  const arenaLabel = basename(arena)
  const logFile = join(runDir, `server-${profileArm}-${phase}.log`)

  if (profileArm === 'enabled' && phase === 'train') resetBenchDb()
  clearArenaSessions()

  console.log(`[${resultArm}/${phase}] starting dsh web (${cfg.profiles[profileArm]}, port ${cfg.ports[profileArm]})...`)
  const server = await startServer(cfg, profileArm, logFile)
  console.log(`[${resultArm}/${phase}] server up: ${server.tokenUrl}`)
  const { browser, page } = await launchBrowser(cfg)
  try {
    for (const task of tasks) {
      seedArena(task, arena)
      const startedAtMs = Date.now()
      const screenshot = join(shotsRoot, `${resultArm}-${phase}-${task.id}.png`)
      console.log(`[${resultArm}/${phase}] ${task.id} (${task.family}): sending prompt...`)
      const outcome = await runTaskInUi(page, cfg, {
        tokenUrl: server.tokenUrl,
        arenaPath: arena,
        arenaLabel,
        prompt: task.prompt,
        screenshotPath: screenshot,
      })
      // Tamper-proof grading: restore the author's test.cjs before grading so
      // an agent that edited the grader cannot certify its own work.
      copyFileSync(join(seedDir(task), 'test.cjs'), join(arena, 'test.cjs'))
      const grade = gradeWorkspace(arena)
      const metrics = extractMetrics(cfg, arena, startedAtMs)
      const record = {
        run: runDir,
        arm: resultArm,
        phase,
        set: task.set ?? (phase === 'train' ? 'train' : 'test'),
        taskId: task.id,
        family: task.family,
        startedAt: new Date(startedAtMs).toISOString(),
        durationS: Math.round((Date.now() - startedAtMs) / 100) / 10,
        uiTimeout: outcome?.timeout ?? false,
        stopClicked: outcome?.stopClicked ?? false,
        abortConfirmed: outcome?.abortConfirmed ?? false,
        pass: grade.pass,
        gradeOutput: grade.pass ? grade.stdout.trim().split('\n').pop() : `${grade.stdout}\n${grade.stderr}`.trim().split('\n').pop(),
        metrics,
        workspace: arena,
        screenshot,
      }
      appendFileSync(join(runDir, 'runs.jsonl'), `${JSON.stringify(record)}\n`)
      console.log(`[${resultArm}/${phase}] ${task.id}: ${grade.pass ? 'PASS' : 'FAIL'} in ${record.durationS}s`)
    }
  } finally {
    await browser.close().catch(() => {})
    await killTree(server)
  }

  const contamination = checkPluginMarkers(logFile, profileArm)
  for (const problem of contamination) console.error(`[${resultArm}/${phase}] CONTAMINATION GUARD: ${problem}`)
  if (contamination.length) throw new Error(`phase ${resultArm}/${phase} failed its plugin-marker guard`)
}

async function runArm(arm, taskIds, runDir) {
  const manifest = loadManifest()
  const trainTasks = (manifest.train ?? []).map((id) => taskById(manifest, id))
  const testTasks = (manifest.test ?? manifest.order ?? []).map((id) => taskById(manifest, id))

  if (arm === 'baseline') {
    const tasks = taskIds ? taskIds.map((id) => taskById(manifest, id)) : testTasks
    await runPhase({ resultArm: 'baseline', profileArm: 'baseline', phase: 'test', tasks, runDir })
    const rows = readRows(runDir).filter((r) => r.arm === 'baseline')
    console.log(`[baseline] test: ${rows.filter((r) => r.pass).length}/${rows.length} passed`)
    return
  }

  if (arm === 'enabled') {
    // Phase 1 — training: WRITABLE store accumulates experiences.
    const train = taskIds
      ? taskIds.filter((id) => manifest.train.includes(id)).map((id) => taskById(manifest, id))
      : trainTasks
    await runPhase({ resultArm: 'enabled', profileArm: 'enabled', phase: 'train', tasks: train, runDir })

    // Checkpoint: the trained library is the entire treatment under test.
    const stats = experienceStats(cfg)
    console.log(`[enabled] TRAIN CHECKPOINT: ${stats.available ? `${stats.experiences} entries, ${stats.withLessons} with lessons, avg confidence ${stats.avgConfidence}` : stats.reason}`)
    if (existsSync(cfg.dbPath)) copyFileSync(cfg.dbPath, join(runDir, 'trained-experiences.db'))

    // Phase 2 — test: read-only store (recordExperiences:false) so test turns
    // never leak back into the trained library.
    const test = taskIds
      ? taskIds.filter((id) => !manifest.train.includes(id)).map((id) => taskById(manifest, id))
      : testTasks
    await runPhase({ resultArm: 'enabled', profileArm: 'enabledRo', phase: 'test', tasks: test, runDir })

    const rows = readRows(runDir).filter((r) => r.arm === 'enabled')
    for (const phase of ['train', 'test']) {
      const sub = rows.filter((r) => r.phase === phase)
      console.log(`[enabled] ${phase}: ${sub.filter((r) => r.pass).length}/${sub.length} passed`)
    }
    return
  }
  throw new Error(`unknown arm: ${arm}`)
}

function readRows(runDir) {
  return readFileSync(join(runDir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

async function runCommand(flags) {
  if (!flags.arm || !['baseline', 'enabled'].includes(flags.arm)) throw new Error('--arm baseline|enabled is required')
  const tag = flags.tag ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const runDir = join(ROOT, 'runs', tag)
  mkdirSync(runDir, { recursive: true })
  console.log(`run dir: ${runDir}`)
  await runArm(flags.arm, flags.tasks, runDir)
}

async function smoke() {
  const tag = `smoke-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const runDir = join(ROOT, 'runs', tag)
  mkdirSync(runDir, { recursive: true })
  console.log(`SMOKE: 1 train + 1 test (enabled, read-only phase included) + 1 test (baseline), run dir ${runDir}`)
  await runArm('baseline', ['u1'], runDir)
  await runArm('enabled', ['uw1', 'u1'], runDir)
  buildReport(runDir)
  console.log(`report: ${join(runDir, 'report.md')}`)
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command) return usage()
  if (command === 'prepare') return prepare()
  if (command === 'verify-seeds') return verifySeeds()
  if (command === 'run') return runCommand(parseArgs(rest))
  if (command === 'smoke') return smoke()
  if (command === 'report') {
    const flags = parseArgs(rest)
    let runDir
    if (flags.tag) {
      runDir = join(ROOT, 'runs', flags.tag)
    } else {
      const entries = readdirSync(join(ROOT, 'runs'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
      if (!entries.length) throw new Error('no run directories under runs/')
      runDir = join(ROOT, 'runs', entries[entries.length - 1])
    }
    buildReport(runDir)
    console.log(`report written: ${join(runDir, 'report.md')}`)
    return
  }
  usage()
  throw new Error(`unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error.stack || error.message || error)
  process.exit(1)
})
