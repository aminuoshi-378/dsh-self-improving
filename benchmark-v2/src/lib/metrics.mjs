import { existsSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** ~/.dsh/sessions/--encoded-workspace-path--/ (observed encoding rule). */
export function sessionDirFor(cfg, workspacePath) {
  const encoded = `--${workspacePath.replace(/^\//, '').replace(/\//g, '-')}--`
  return join(cfg.dshHome, 'sessions', encoded)
}

function readLines(sessionDir, startedAtMs) {
  if (!existsSync(sessionDir)) return { error: 'session dir missing' }
  const candidates = readdirSync(sessionDir)
    .filter((name) => name.startsWith('session-'))
    .map((name) => {
      const dir = join(sessionDir, name)
      const file = join(dir, 'session.jsonl.zstd')
      const mtimeMs = existsSync(file) ? statSync(file).mtimeMs : 0
      return { dir, file, mtimeMs }
    })
    .filter((entry) => entry.mtimeMs >= startedAtMs - 5_000 && existsSync(entry.file))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  if (candidates.length === 0) return { error: 'no session file in time window' }
  const decompress = spawnSync('zstd', ['-dc', candidates[0].file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (decompress.status !== 0) return { error: `zstd failed: ${decompress.stderr?.slice(0, 200)}` }
  return { lines: decompress.stdout.split('\n').filter(Boolean), file: candidates[0].file }
}

/** Token/turn/tool metrics for the newest session of a workspace after startedAtMs. */
export function extractMetrics(cfg, workspacePath, startedAtMs) {
  const { lines, file, error } = readLines(sessionDirFor(cfg, workspacePath), startedAtMs)
  if (error) return { available: false, reason: error }
  let sessionId = null
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let turns = 0
  let toolCalls = 0
  for (const line of lines) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'session') sessionId = event.id
    const chunk = event.data?.chunk
    if (chunk?.type === 'usage') {
      inputTokens += chunk.usage?.inputTokens ?? 0
      outputTokens += chunk.usage?.outputTokens ?? 0
      cacheReadTokens += chunk.usage?.cacheReadTokens ?? 0
    }
    if (typeof event.data?.turn === 'number' && event.data.turn > turns) turns = event.data.turn
    if (chunk?.type === 'tool-call') toolCalls++
  }
  return { available: true, sessionId, file, inputTokens, outputTokens, cacheReadTokens, turns, toolCalls }
}

/** Experience-store stats via the system sqlite3 CLI (enabled arm only). */
export function experienceStats(cfg) {
  if (!existsSync(cfg.dbPath)) return { available: false, reason: 'db not created yet' }
  const query = (sql) =>
    spawnSync('sqlite3', [cfg.dbPath, sql], { encoding: 'utf8' }).stdout.trim()
  return {
    available: true,
    experiences: Number(query('SELECT COUNT(*) FROM experiences;') || 0),
    withLessons: Number(query('SELECT COUNT(*) FROM experiences WHERE lesson IS NOT NULL;') || 0),
    avgConfidence: Number(query('SELECT ROUND(AVG(confidence), 3) FROM experiences;') || 0),
  }
}
