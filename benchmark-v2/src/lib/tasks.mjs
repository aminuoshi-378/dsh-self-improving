import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from './config.mjs'

/** Load the task manifest (order, heldOut, prompts). */
export function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'tasks', 'manifest.json'), 'utf8'))
}

export function taskById(manifest, id) {
  const task = manifest.tasks.find((entry) => entry.id === id)
  if (!task) throw new Error(`unknown task id: ${id}`)
  return task
}

/** Resolve the seed directory of a task (tasks/<family>/<id>). */
export function seedDir(task) {
  return join(ROOT, 'tasks', task.family, task.id)
}

/** The solution file never copied into workspaces (authoring validation only). */
export function solutionFile(task) {
  return join(ROOT, 'solutions', task.family, `${task.id}.cjs`)
}

/** Every JavaScript source in the task seed directory (multi-file refactor
 * tasks carry several '.js' modules beside the traditional bug.cjs + test.cjs
 * pair; both extensions are workspace content). */
export function seedFiles(task) {
  return readdirSync(seedDir(task)).filter((file) => file.endsWith('.cjs') || file.endsWith('.js'))
}

/** Copy the seed files into a fresh, empty workspace directory. */
export function seedWorkspace(task, destDir) {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  for (const file of seedFiles(task)) {
    copyFileSync(join(seedDir(task), file), join(destDir, file))
  }
  return destDir
}

/**
 * Seed one task into the shared arena workspace: wipe ALL arena content first
 * (previous task leftovers must never leak into the next one), then copy the
 * seed files. The arena DIRECTORY itself survives (the Host workspace entity
 * references it by path).
 */
export function seedArena(task, arenaDir) {
  if (!existsSync(arenaDir)) mkdirSync(arenaDir, { recursive: true })
  for (const entry of readdirSync(arenaDir)) {
    rmSync(join(arenaDir, entry), { recursive: true, force: true })
  }
  for (const file of seedFiles(task)) {
    copyFileSync(join(seedDir(task), file), join(arenaDir, file))
  }
  return arenaDir
}

/** Machine grade: `node test.cjs` exit code in the workspace. */
export function gradeWorkspace(workspaceDir) {
  const run = spawnSync('node', ['test.cjs'], { cwd: workspaceDir, encoding: 'utf8' })
  return {
    pass: run.status === 0,
    status: run.status,
    stdout: (run.stdout ?? '').slice(-2000),
    stderr: (run.stderr ?? '').slice(-2000),
  }
}
