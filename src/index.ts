/**
 * dsh-self-improving — Plugin Entry Point for real dsh runtime.
 *
 * Mounts the four-layer learning system onto dsh's actual event hooks:
 *
 *   Layer 1: Outcome Evaluator     → tools/result (observe tool outcomes)
 *   Layer 2: Behavior Adapter       → agent/pre-step (inject experience)
 *                                     systemPrompt.section (learned prefs)
 *   Layer 3: Experience Store      → SQLite sidecar table
 *   Layer 4: Meta-Cognition Engine  → agent/turn-stopping (queue reflection)
 *                                     agent.runMaintenance (process queue)
 *
 * All injection is advisory — the model can heed or ignore it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { MessageSource, UserMessage } from '@deepseek-ai/dsh-llm'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { ulid } from 'ulid'
import { computeStepEfficiency, computeDifficulty, extractLessonText, inferTaskPattern } from './types/index.js'

export const name = 'self-improving'

// Cordis inject: wait for these services to be ready before applying.
// - 'tools' for the tools/result event
// - 'systemPrompt' for the section() registration
// - 'agents' for the agent/pre-step and agent/turn-stopping events
export const inject = ['tools', 'systemPrompt']

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface Config {
  dbPath: string
  metaCognitionEnabled: boolean
  behaviorAdapterEnabled: boolean
  minInjectionScore: number
}

export function rulesSchema() {
  return {
    title: 'dsh-self-improving',
    type: 'object',
    properties: {
      dbPath: { type: 'string', default: ':memory:' },
      metaCognitionEnabled: { type: 'boolean', default: true },
      behaviorAdapterEnabled: { type: 'boolean', default: true },
      minInjectionScore: { type: 'number', default: 0.3 },
    },
  }
}

// ---------------------------------------------------------------------------
// Experience Store (Layer 3) — inlined for single-file plugin
// ---------------------------------------------------------------------------

interface ExperienceRecord {
  id: string
  sessionId: string
  turnId: string
  createdAt: number
  contextHash: string
  taskPattern: string | null
  toolsUsed: string[] | null
  workspaceDigest: string | null
  actions: string
  outcomeScore: number
  userFeedback: string
  lesson: string | null
  difficulty: 'low' | 'medium' | 'high'
  generation: number
  lastInjectedAt: number | null
  merged: boolean
  confidence: number
  reuseCount: number
}

class ExperienceStore {
  private db: DatabaseType

  constructor(dbPath: string = ':memory:') {
    // Expand ~ to home directory
    const resolvedPath = dbPath.startsWith('~/')
      ? dbPath.replace('~/', `${process.env.HOME}/`)
      : dbPath
    // Ensure parent dir exists for file-based db
    if (resolvedPath !== ':memory:') {
      const dir = resolvedPath.replace(/\/[^/]+$/, '')
      try { require('node:fs').mkdirSync(dir, { recursive: true }) } catch {}
    }
    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        task_unit_id TEXT NOT NULL DEFAULT '',
        goal_id TEXT,
        context_hash TEXT NOT NULL,
        content_hash TEXT,
        task_pattern TEXT,
        tools_used TEXT,
        workspace_digest TEXT,
        actions TEXT NOT NULL,
        outcome_score REAL,
        user_feedback TEXT,
        lesson TEXT,
        difficulty TEXT DEFAULT 'medium',
        generation INTEGER DEFAULT 0,
        last_injected_at INTEGER,
        merged INTEGER DEFAULT 0,
        confidence REAL DEFAULT 1.0,
        reuse_count INTEGER DEFAULT 0
      );
    `)

    // Migration: add columns that may not exist in older databases
    this.ensureColumn('difficulty', "TEXT DEFAULT 'medium'")
    this.ensureColumn('generation', 'INTEGER DEFAULT 0')
    this.ensureColumn('last_injected_at', 'INTEGER')
    this.ensureColumn('merged', 'INTEGER DEFAULT 0')
    this.ensureColumn('task_unit_id', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('goal_id', 'TEXT')
    this.ensureColumn('content_hash', 'TEXT')

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exp_context ON experiences(context_hash);
      CREATE INDEX IF NOT EXISTS idx_exp_task ON experiences(task_pattern);
      CREATE INDEX IF NOT EXISTS idx_exp_score ON experiences(outcome_score DESC);
      CREATE INDEX IF NOT EXISTS idx_exp_difficulty ON experiences(difficulty);
      CREATE INDEX IF NOT EXISTS idx_exp_generation ON experiences(generation);
      CREATE INDEX IF NOT EXISTS idx_exp_merged ON experiences(merged);
      CREATE INDEX IF NOT EXISTS idx_exp_content_hash ON experiences(content_hash);
    `)
  }

  /** Add a column to the experiences table if it doesn't already exist (migration support). */
  private ensureColumn(columnName: string, definition: string): void {
    const cols = this.db.prepare('PRAGMA table_info(experiences)').all() as { name: string }[]
    if (!cols.some((c) => c.name === columnName)) {
      this.db.exec(`ALTER TABLE experiences ADD COLUMN ${columnName} ${definition}`)
    }
  }

  store(
    sessionId: string,
    turnId: string,
    outcomeScore: number,
    userFeedback: string,
    toolsUsed: string[],
    actions: string,
    workspaceDigest: string | null,
    difficulty: 'low' | 'medium' | 'high' = 'medium',
    taskPattern: string | null = null,
    taskUnitId?: string,
    goalId?: string | null,
  ): string {
    const id = ulid()
    const taskUnit = taskUnitId ?? id
    const contextHash = [taskPattern ?? '', toolsUsed.slice().sort().join(','), workspaceDigest ?? ''].join('|')
    // E2: content_hash — sha1 of ordered tool call sequence (with success/failure) + workspace
    let contentHash: string | null = null
    try {
      const crypto = require('node:crypto')
      const parsed = JSON.parse(actions)
      const tools = (parsed.tools ?? []) as { name: string; success: boolean }[]
      if (Array.isArray(tools) && tools.length > 0) {
        const toolStr = tools.map((t) => `${t.name}:${t.success}`).join(',')
        contentHash = crypto.createHash('sha1').update(`${toolStr}|${workspaceDigest ?? ''}`).digest('hex').slice(0, 16)
      }
    } catch { contentHash = null }

    this.db.prepare(`
      INSERT INTO experiences (id, session_id, turn_id, created_at, task_unit_id, goal_id,
        context_hash, content_hash, task_pattern, tools_used, workspace_digest, actions, outcome_score,
        user_feedback, lesson, difficulty, generation, last_injected_at, merged,
        confidence, reuse_count)
      VALUES (@id, @sessionId, @turnId, @createdAt, @taskUnit, @goalId,
        @contextHash, @contentHash, @taskPattern, @toolsUsed, @ws, @actions, @score, @feedback, NULL,
        @difficulty, 0, NULL, 0, 1.0, 0)
    `).run({
      id, sessionId, turnId, createdAt: Date.now(),
      taskUnit, goalId: goalId ?? null,
      contextHash, contentHash, taskPattern, toolsUsed: JSON.stringify(toolsUsed),
      ws: workspaceDigest, actions, score: outcomeScore, feedback: userFeedback,
      difficulty,
    })

    // Enforce retention limit of 1000
    const count = this.count()
    if (count > 1000) {
      this.db.prepare(`
        DELETE FROM experiences WHERE id IN (
          SELECT id FROM experiences ORDER BY outcome_score ASC, created_at ASC LIMIT ?
        )
      `).run(count - 1000)
    }

    return id
  }

  query(toolsUsed: string[], workspaceDigest: string | null, limit: number = 5, minScore: number = 0.0): ExperienceRecord[] {
    const totalCount = this.count()
    // P4: Dynamic candidate set sizing
    const coarseLimit = totalCount < 50 ? Math.max(limit * 5, 50) : totalCount < 200 ? 20 : 50

    // Stage 1: Coarse filter (P4) — exclude merged records
    const rows = this.db.prepare(`
      SELECT * FROM experiences WHERE outcome_score >= ? AND merged = 0
      ORDER BY outcome_score DESC, created_at DESC LIMIT ?
    `).all(minScore, coarseLimit) as any[]

    const records = rows.map(r => this.rowToRecord(r))

    // P0: Deduplicate by context_hash — keep only the newest
    const deduped = this.deduplicateByContextHash(records)

    if (toolsUsed.length === 0 && !workspaceDigest) {
      // P0: Sort by difficulty priority then score
      return deduped
        .sort((a, b) => {
          const dp = this.difficultyPriority(b.difficulty) - this.difficultyPriority(a.difficulty)
          return dp !== 0 ? dp : b.outcomeScore - a.outcomeScore
        })
        .slice(0, limit)
    }

    // Stage 2: Fine re-rank by composite score (P4)
    // outcome_score * 0.4 + tools_similarity * 0.3 + recency * 0.3
    return deduped
      .map(rec => ({
        rec,
        rank: rec.outcomeScore * 0.4 + this.similarity(rec, toolsUsed, workspaceDigest) * 0.3
          + Math.exp(-(Date.now() - rec.createdAt) / (30 * 24 * 60 * 60 * 1000)) * 0.3,
      }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map(item => item.rec)
  }

  /** P0: Deduplicate by context_hash, keeping the newest for each */
  private deduplicateByContextHash(records: ExperienceRecord[]): ExperienceRecord[] {
    const seen = new Map<string, ExperienceRecord>()
    for (const rec of records) {
      const existing = seen.get(rec.contextHash)
      if (!existing || rec.createdAt > existing.createdAt) {
        seen.set(rec.contextHash, rec)
      }
    }
    return [...seen.values()]
  }

  /** P0: Difficulty priority for injection ordering */
  difficultyPriority(difficulty: string): number {
    switch (difficulty) {
      case 'high': return 3
      case 'medium': return 2
      case 'low': return 1
      default: return 2
    }
  }

  /** P4: Update lesson with structured Reflection (stored as JSON) */
  updateLesson(id: string, reflection: {
    whatWorked: string
    whatFailed: string
    whatToTryDifferently: string
    reusableLesson: string
  }): void {
    this.db.prepare('UPDATE experiences SET lesson = ? WHERE id = ?')
      .run(JSON.stringify(reflection), id)
  }

  incrementReuse(id: string): void {
    this.db.prepare(`
      UPDATE experiences SET reuse_count = reuse_count + 1,
        confidence = MAX(0.1, 1.0 - (reuse_count + 1) * 0.1),
        last_injected_at = ? WHERE id = ?
    `).run(Date.now(), id)
  }

  boostConfidence(id: string): void {
    this.db.prepare('UPDATE experiences SET confidence = MIN(1.0, confidence + 0.2) WHERE id = ?').run(id)
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM experiences').get() as any).c
  }

  stats(): {
    total: number; avgScore: number; positive: number; withLessons: number
    youngGenCount: number; oldGenCount: number; highDifficultyCount: number; mergedCount: number
  } {
    const r = this.db.prepare(`
      SELECT COUNT(*) as total, COALESCE(AVG(outcome_score), 0) as avgScore,
        SUM(CASE WHEN user_feedback = 'positive' THEN 1 ELSE 0 END) as positive,
        SUM(CASE WHEN lesson IS NOT NULL THEN 1 ELSE 0 END) as withLessons,
        SUM(CASE WHEN generation = 0 THEN 1 ELSE 0 END) as youngGenCount,
        SUM(CASE WHEN generation = 1 THEN 1 ELSE 0 END) as oldGenCount,
        SUM(CASE WHEN difficulty = 'high' THEN 1 ELSE 0 END) as highDifficultyCount,
        SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as mergedCount
      FROM experiences
    `).get() as any
    return {
      total: r.total, avgScore: r.avgScore, positive: r.positive ?? 0, withLessons: r.withLessons ?? 0,
      youngGenCount: r.youngGenCount ?? 0, oldGenCount: r.oldGenCount ?? 0,
      highDifficultyCount: r.highDifficultyCount ?? 0, mergedCount: r.mergedCount ?? 0,
    }
  }

  private similarity(rec: ExperienceRecord, tools: string[], ws: string | null): number {
    let score = 0, weight = 0
    if (rec.toolsUsed && tools.length > 0) {
      weight += 0.6
      const qs = new Set(tools), rs = new Set(rec.toolsUsed)
      const inter = [...qs].filter(t => rs.has(t)).length
      const union = new Set([...qs, ...rs]).size
      score += 0.6 * (union > 0 ? inter / union : 0)
    }
    if (ws && rec.workspaceDigest && rec.workspaceDigest === ws) { weight += 0.4; score += 0.4 }
    return weight > 0 ? score / weight : 0.5
  }

  private rowToRecord(r: any): ExperienceRecord {
    return {
      id: r.id, sessionId: r.session_id, turnId: r.turn_id, createdAt: r.created_at,
      contextHash: r.context_hash, taskPattern: r.task_pattern,
      toolsUsed: r.tools_used ? JSON.parse(r.tools_used) : null,
      workspaceDigest: r.workspace_digest, actions: r.actions,
      outcomeScore: r.outcome_score, userFeedback: r.user_feedback,
      lesson: r.lesson, difficulty: r.difficulty ?? 'medium',
      generation: r.generation ?? 0, lastInjectedAt: r.last_injected_at ?? null,
      merged: Boolean(r.merged),
      confidence: r.confidence, reuseCount: r.reuse_count,
    }
  }

  /** P2: Get unmerged lesson groups for consolidation */
  getUnmergedLessonGroups(threshold: number = 20): {
    difficulty: string
    toolsKey: string
    records: ExperienceRecord[]
  }[] {
    const unmergedCount = (this.db.prepare(
      `SELECT COUNT(*) as c FROM experiences WHERE lesson IS NOT NULL AND merged = 0`,
    ).get() as any).c

    if (unmergedCount < threshold) return []

    const rows = this.db.prepare(`
      SELECT * FROM experiences
      WHERE lesson IS NOT NULL AND merged = 0
      ORDER BY difficulty DESC, created_at DESC
    `).all() as any[]

    const records = rows.map(r => this.rowToRecord(r))

    const groups = new Map<string, ExperienceRecord[]>()
    for (const rec of records) {
      const toolsKey = rec.toolsUsed ? [...rec.toolsUsed].sort().join(',') : 'none'
      const key = `${rec.difficulty}|${toolsKey}`
      const group = groups.get(key) ?? []
      group.push(rec)
      groups.set(key, group)
    }

    return [...groups.entries()]
      .filter(([, recs]) => recs.length >= 2)
      .map(([key, recs]) => {
        const [difficulty, toolsKey] = key.split('|')
        return { difficulty, toolsKey, records: recs }
      })
  }

  /** P2: Merge lessons into a consolidated record */
  mergeLessons(
    sourceIds: string[],
    mergedLesson: {
      whatWorked: string
      whatFailed: string
      whatToTryDifferently: string
      reusableLesson: string
    },
    difficulty: 'low' | 'medium' | 'high',
    toolsUsed: string[],
  ): string {
    const id = ulid()
    const contextHash = toolsUsed.slice().sort().join(',')

    this.db.prepare(`
      INSERT INTO experiences (id, session_id, turn_id, created_at, context_hash,
        task_pattern, tools_used, workspace_digest, actions, outcome_score,
        user_feedback, lesson, difficulty, generation, last_injected_at, merged,
        confidence, reuse_count)
      VALUES (@id, @sessionId, @turnId, @createdAt, @contextHash,
        NULL, @toolsUsed, NULL, @actions, 0.85, 'none',
        @lesson, @difficulty, 1, NULL, 0, 1.0, 0)
    `).run({
      id, sessionId: 'merge', turnId: `merge-${Date.now()}`, createdAt: Date.now(),
      contextHash, toolsUsed: JSON.stringify(toolsUsed),
      actions: JSON.stringify({ merged_from: sourceIds }),
      lesson: JSON.stringify(mergedLesson), difficulty,
    })

    for (const sourceId of sourceIds) {
      this.db.prepare('UPDATE experiences SET merged = 1 WHERE id = ?').run(sourceId)
    }

    return id
  }

  /** P5: Export all experiences as JSON array */
  exportAll(): any[] {
    return this.db.prepare('SELECT * FROM experiences ORDER BY created_at ASC').all()
      .map((r: any) => this.rowToRecord(r))
      .map((rec: ExperienceRecord) => ({
        id: rec.id,
        outcomeScore: rec.outcomeScore,
        toolsUsed: rec.toolsUsed,
        lesson: rec.lesson,
        difficulty: rec.difficulty,
        taskPattern: rec.taskPattern,
        generation: rec.generation,
        merged: rec.merged,
        confidence: rec.confidence,
        reuseCount: rec.reuseCount,
        createdAt: rec.createdAt,
        actions: rec.actions,
      }))
  }

  /** P5: Export filtered by task pattern */
  exportByTaskPattern(taskPattern: string): any[] {
    return this.db.prepare('SELECT * FROM experiences WHERE task_pattern = ? ORDER BY created_at ASC')
      .all(taskPattern)
      .map((r: any) => this.rowToRecord(r))
      .map((rec: ExperienceRecord) => ({
        id: rec.id,
        outcomeScore: rec.outcomeScore,
        toolsUsed: rec.toolsUsed,
        lesson: rec.lesson,
        difficulty: rec.difficulty,
        taskPattern: rec.taskPattern,
        generation: rec.generation,
        merged: rec.merged,
        confidence: rec.confidence,
        reuseCount: rec.reuseCount,
        createdAt: rec.createdAt,
        actions: rec.actions,
      }))
  }

  /** P5: Import experiences from JSON array */
  importExperiences(data: any[]): { imported: number; skipped: number; invalid: number } {
    let imported = 0, skipped = 0, invalid = 0
    const existingIds = new Set(
      (this.db.prepare('SELECT id FROM experiences').all() as any[]).map((r: any) => r.id),
    )
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO experiences (
        id, session_id, turn_id, created_at, context_hash,
        task_pattern, tools_used, workspace_digest, actions, outcome_score,
        user_feedback, lesson, difficulty, generation, last_injected_at, merged,
        confidence, reuse_count)
      VALUES (@id, 'import', @turnId, @createdAt, @contextHash,
        @taskPattern, @toolsUsed, NULL, @actions, @outcomeScore,
        'none', @lesson, @difficulty, 0, NULL, @merged,
        @confidence, @reuseCount)
    `)
    for (const item of data) {
      if (typeof item !== 'object' || item === null ||
          typeof item.id !== 'string' || typeof item.outcomeScore !== 'number') {
        invalid++; continue
      }
      if (existingIds.has(item.id)) { skipped++; continue }
      const tools = item.toolsUsed
      const contextHash = Array.isArray(tools)
        ? [...tools].sort().join(',')
        : ''
      insertStmt.run({
        id: item.id,
        turnId: `import-${item.createdAt}`,
        createdAt: item.createdAt || Date.now(),
        contextHash,
        taskPattern: item.taskPattern ?? null,
        toolsUsed: Array.isArray(tools) ? JSON.stringify(tools) : null,
        actions: item.actions ?? '{}',
        outcomeScore: item.outcomeScore,
        lesson: item.lesson ?? null,
        difficulty: item.difficulty ?? 'medium',
        merged: item.merged ? 1 : 0,
        confidence: item.confidence ?? 1.0,
        reuseCount: item.reuseCount ?? 0,
      })
      existingIds.add(item.id)
      imported++
    }
    return { imported, skipped, invalid }
  }

  close(): void { this.db.close() }
  clear(): void { this.db.exec('DELETE FROM experiences') }
}

// ---------------------------------------------------------------------------
// Plugin apply — wires everything to dsh's real event hooks
// ---------------------------------------------------------------------------

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'self-improving' }

/** Simple stderr logger — works in headless and web mode, visible on console */
function log(msg: string, data?: unknown): void {
  if (data !== undefined) {
    process.stderr.write(`[self-improving] ${msg} ${JSON.stringify(data)}\n`)
  } else {
    process.stderr.write(`[self-improving] ${msg}\n`)
  }
}

// ---------------------------------------------------------------------------
// A1-a: User preference extraction (rule-based, writes to ~/.dsh/preferences.md)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** Resolve preferences file path from config or DSH_HOME. */
function getPreferencesFilePath(dshHome?: string): string {
  const home = dshHome || process.env.DSH_HOME || `${process.env.HOME}/.dsh`
  return join(home, 'preferences.md')
}

/** Read current preferences file content. Returns empty string if file doesn't exist. */
function readPreferences(filePath: string): string {
  try {
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8').trim()
  } catch {
    return ''
  }
}

/**
 * A1-a: Extract explicit preference declarations from user message text.
 * Detects patterns like "请记住我偏好简洁回答", "以后总是用TypeScript",
 * "记住我喜欢中文回复", "remember I prefer concise answers".
 * Returns the extracted preference text, or null if no preference detected.
 */
const PREFERENCE_TRIGGERS = [
  /(?:请记住|记住|以后总是|我偏好|我喜欢|我习惯于|请确保|务必|remember\s+(?:that\s+)?(?:I|that)\s+(?:prefer|like|always|usually)|from\s+now\s+on)\s*[:：]?\s*(.+)/i,
  /(?:偏好|习惯|要求|规则)\s*[:：]\s*(.+)/i,
]

const PREFERENCE_STOPWORDS = /^(?:帮我|请帮|能不能|可以|帮我修|帮我写|帮我查|帮我找|create|edit|fix|write|read|search|find)\b/i

function extractPreference(userText: string): string | null {
  if (!userText || userText.length < 8) return null
  // Skip obvious task instructions that look like preferences
  if (PREFERENCE_STOPWORDS.test(userText.trim())) return null

  for (const pattern of PREFERENCE_TRIGGERS) {
    const match = userText.match(pattern)
    if (match && match[1]) {
      const pref = match[1].trim()
      // Sanity check: preference should be reasonably short and not a full task description
      if (pref.length >= 2 && pref.length <= 200) {
        return pref
      }
    }
  }
  return null
}

/**
 * A1-a: Append a preference to the preferences file, with deduplication.
 * Checks if an equivalent preference already exists (case-insensitive substring match).
 * Returns true if a new preference was added, false if it was a duplicate.
 */
function appendPreference(filePath: string, preference: string): boolean {
  const existing = readPreferences(filePath)
  const normalized = preference.toLowerCase().trim()

  // Check for duplicates — if the new preference text is a substring of existing content
  if (existing && existing.toLowerCase().includes(normalized)) {
    return false
  }

  // Build the new content
  const line = `- ${preference}`
  let content: string
  if (!existing) {
    content = `# User Preferences (advisory)\n\n${line}\n`
  } else {
    content = `${existing}\n${line}\n`
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * P2: Generate a structured reflection (Reflection JSON) from turn data.
 * This is the rule-based fallback when no LLM is available.
 * Produces actionable, context-specific lessons.
 */
function generateStructuredReflection(entry: {
  actions: string
  outcomeScore: number
  userFeedback: string
  toolsUsed: string[]
  stepCount?: number
  difficulty?: 'low' | 'medium' | 'high'
}): {
  whatWorked: string
  whatFailed: string
  whatToTryDifferently: string
  reusableLesson: string
} {
  let parsedActions: any = {}
  try { parsedActions = JSON.parse(entry.actions) } catch {}

  const toolNames = parsedActions.tools?.map((t: any) => t.tool).filter(Boolean) ?? entry.toolsUsed
  const guardCount = parsedActions.guards?.length ?? 0
  const stepInfo = entry.stepCount ? ` in ${entry.stepCount} steps` : ''
  const diffInfo = entry.difficulty ? ` (difficulty: ${entry.difficulty})` : ''

  let whatWorked: string
  let whatFailed: string
  let whatToTryDifferently: string
  let reusableLesson: string

  if (entry.outcomeScore >= 0.8) {
    whatWorked = `Tool sequence [${toolNames.join(' → ')}]${stepInfo}${diffInfo} achieved a strong outcome (score: ${entry.outcomeScore.toFixed(2)})`
    whatFailed = 'No significant failures detected'
    whatToTryDifferently = 'Continue using this approach for similar tasks'
    reusableLesson = `For ${entry.difficulty ?? 'medium'} tasks, [${toolNames.join(' → ')}] is effective${stepInfo}`
  } else if (entry.outcomeScore <= 0.3) {
    whatWorked = 'No clearly successful elements identified'
    const failedTools = parsedActions.tools?.filter((t: any) => !t.ok).map((t: any) => t.tool) ?? []
    whatFailed = failedTools.length > 0
      ? `Tools [${failedTools.join(', ')}] failed${stepInfo}${diffInfo} (score: ${entry.outcomeScore.toFixed(2)})`
      : `Overall outcome was poor (score: ${entry.outcomeScore.toFixed(2)})${diffInfo}`
    whatToTryDifferently = guardCount > 0
      ? 'Avoid repeating the same tool calls — try a different approach'
      : 'Consider breaking the task into smaller steps or using different tools'
    reusableLesson = `When facing ${entry.difficulty ?? 'medium'} tasks similar to this, avoid [${failedTools.join(', ') || toolNames.join(', ')}] — try an alternative approach`
  } else {
    whatWorked = `Partial success with [${toolNames.join(' → ')}]${stepInfo} (score: ${entry.outcomeScore.toFixed(2)})`
    whatFailed = guardCount > 0
      ? `Guard triggers (${guardCount}) suggest inefficiency or looping`
      : 'Mixed results — some tools succeeded, others did not'
    whatToTryDifferently = 'Review tool selection and optimize the sequence'
    reusableLesson = `For ${entry.difficulty ?? 'medium'} tasks, [${toolNames.join(' → ')}] gives mixed results${stepInfo} — consider alternatives for failing steps`
  }

  return { whatWorked, whatFailed, whatToTryDifferently, reusableLesson }
}

/**
 * P2: Rule-based lesson merging (fallback when no LLM available).
 * Consolidates related lessons into a single general lesson.
 */
function mergeLessonsRuleBased(records: ExperienceRecord[]): {
  whatWorked: string
  whatFailed: string
  whatToTryDifferently: string
  reusableLesson: string
} {
  const lessons = records.map(r => {
    try {
      const parsed = JSON.parse(r.lesson ?? '{}')
      return parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson ?? ''
    } catch {
      return r.lesson ?? ''
    }
  }).filter(l => l.length > 0)

  return {
    whatWorked: `Consolidated from ${records.length} experiences`,
    whatFailed: 'See individual records for specific failures',
    whatToTryDifferently: 'Apply the consolidated lesson',
    reusableLesson: lessons.join('; ') || 'No specific lesson extracted',
  }
}

// ---------------------------------------------------------------------------
// LLM bridge — dynamically access ctx.llm without hard dependency
// Used by C5 (lesson merge) and A1-b (preference distillation)
// ---------------------------------------------------------------------------

/**
 * Try to complete a prompt using ctx.llm. Returns null if LLM is unavailable.
 * The prompt is sent as a simple user message; we collect the full text response.
 */
async function tryLLMComplete(ctx: any, prompt: string): Promise<string | null> {
  try {
    const llm = ctx.get?.('llm')
    if (!llm || typeof llm.stream !== 'function') return null

    // Build a minimal model request and collect streamed text
    const chunks: string[] = []
    for await (const chunk of llm.stream({ messages: [{ role: 'user', content: prompt }] })) {
      if (chunk?.type === 'text-delta' && chunk.text) {
        chunks.push(chunk.text)
      } else if (typeof chunk === 'string') {
        chunks.push(chunk)
      }
    }
    return chunks.length > 0 ? chunks.join('') : null
  } catch {
    return null
  }
}

/**
 * C5: LLM-based lesson merging — consolidate related lessons into one general lesson.
 * Falls back to rule-based merging if LLM is unavailable.
 */
async function llmMergeLessons(ctx: any, records: ExperienceRecord[]): Promise<{
  whatWorked: string; whatFailed: string; whatToTryDifferently: string; reusableLesson: string
}> {
  const lessons = records.map(r => {
    try {
      const parsed = JSON.parse(r.lesson ?? '{}')
      return parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson ?? ''
    } catch { return r.lesson ?? '' }
  }).filter(l => l.length > 0)

  const prompt = `You are a lesson consolidation engine. Merge these related lessons into a single consolidated lesson.

## Input Lessons
${JSON.stringify(lessons, null, 2)}

## Task
Find the common pattern across these lessons and produce a single, more general but still actionable lesson.

## Output Format
Respond with ONLY valid JSON, no markdown fences:
{"whatWorked":"merged description","whatFailed":"merged description","whatToTryDifferently":"suggestion","reusableLesson":"consolidated actionable lesson under 50 words"}`

  const response = await tryLLMComplete(ctx, prompt)
  if (response) {
    try {
      // Strip markdown fences if present
      const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      const parsed = JSON.parse(clean)
      return {
        whatWorked: parsed.whatWorked ?? parsed.what_worked ?? '',
        whatFailed: parsed.whatFailed ?? parsed.what_failed ?? '',
        whatToTryDifferently: parsed.whatToTryDifferently ?? parsed.what_to_try_differently ?? '',
        reusableLesson: parsed.reusableLesson ?? parsed.reusable_lesson ?? '',
      }
    } catch { /* fall through to rule-based */ }
  }
  return mergeLessonsRuleBased(records)
}

/**
 * A1-b: LLM-based automatic preference distillation.
 * Analyzes recent lessons and outcome trends to extract high-confidence preferences.
 * Writes results to ~/.dsh/preferences.md with "# [auto]" marker.
 * Returns the number of new auto-preferences written.
 */
async function distillPreferencesWithLLM(ctx: any, store: ExperienceStore, prefPath: string): Promise<number> {
  const stats = store.stats()
  if (stats.total < 20) return 0 // Need minimum data

  // Gather recent lessons for the LLM to analyze
  const recent = store.query({ limit: 30, minScore: 0.0 })
  const lessons = recent
    .filter(r => r.lesson)
    .map(r => {
      try {
        const parsed = JSON.parse(r.lesson!)
        return {
          lesson: parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson,
          difficulty: r.difficulty,
          score: r.outcomeScore,
          tools: r.toolsUsed,
        }
      } catch { return null }
    })
    .filter(Boolean) as { lesson: string; difficulty: string; score: number; tools: string[] | null }[]

  if (lessons.length < 5) return 0

  const prompt = `You are a preference distillation engine. Analyze the following agent experience lessons and extract high-confidence user preferences or behavioral patterns.

## Experience Data (most recent ${lessons.length} lessons)
${JSON.stringify(lessons.slice(0, 20), null, 2)}

## Stats
- Total experiences: ${stats.total}
- Average score: ${stats.avgScore.toFixed(2)}
- Positive feedback: ${stats.positive}
- Negative feedback: ${stats.negative}
- High difficulty: ${stats.highDifficultyCount}

## Task
Extract 0-3 stable preferences that are strongly supported by the data. Only include preferences with high confidence (e.g., consistently positive/negative outcomes with the same pattern). Do NOT speculate.

## Output Format
Respond with ONLY valid JSON array, no markdown fences:
[{"preference":"concise description of preference","confidence":"high"}]

If no high-confidence preferences can be extracted, return an empty array: []`

  const response = await tryLLMComplete(ctx, prompt)
  if (!response) return 0

  try {
    const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(clean) as { preference: string; confidence: string }[]
    if (!Array.isArray(parsed)) return 0

    const existing = readPreferences(prefPath)
    let added = 0
    for (const item of parsed) {
      if (item.confidence !== 'high' || !item.preference) continue
      const pref = item.preference.trim()
      if (pref.length < 2 || pref.length > 200) continue
      // Dedup against existing (case-insensitive)
      if (existing && existing.toLowerCase().includes(pref.toLowerCase())) continue

      // Write with # [auto] marker section
      const line = `- [auto] ${pref}`
      let content: string
      if (!existing) {
        content = `# User Preferences (advisory)\n\n## Auto-distilled\n\n${line}\n`
      } else if (existing.includes('## Auto-distilled')) {
        content = existing.replace(/## Auto-distilled\n/, `## Auto-distilled\n${line}\n`)
      } else {
        content = `${existing}\n## Auto-distilled\n\n${line}\n`
      }
      writeFileSync(prefPath, content, 'utf-8')
      added++
    }
    return added
  } catch {
    return 0
  }
}

export function apply(ctx: Context, config: Config): void {
  const store = new ExperienceStore(config.dbPath)

  log('plugin loaded', { dbPath: config.dbPath, metaCognition: config.metaCognitionEnabled, behaviorAdapter: config.behaviorAdapterEnabled })

  // Per-agent turn tracking: collect tool results during a turn
  // Key: agent.id only (accumulate all tools across steps within a turn)
  // Also tracks step count for efficiency calculation (P0)
  // P-C: taskUnitId tracks cross-turn aggregation for goal-driven tasks
  const agentTools = new Map<string, {
    tools: { name: string; success: boolean }[]
    sessionId: string
    stepCount: number
    injectedThisTurn: boolean  // P0: track if already injected this turn
    taskUnitId: string        // P-C: ULID grouping turns into a task unit
    goalId: string | null     // P-C: dsh goal id if goal-driven
  }>()

  // P-C: Track active task unit per agent (for cross-turn aggregation)
  // When a goal exists, all turns until goal complete share the same taskUnitId.
  // When no goal, each turn is its own task unit (default).
  const agentTaskUnits = new Map<string, { taskUnitId: string; goalId: string | null; turns: number }>()

  // --- Layer 1: Observe tool outcomes via tools/result ---
  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const agent = exec.agent
    if (!agent) return

    if (!agentTools.has(agent.id)) {
      // P-C: Resolve or create task unit for this agent
      let taskUnit = agentTaskUnits.get(agent.id)
      if (!taskUnit) {
        // Check if there's an active goal
        let goalId: string | null = null
        try {
          const goalService = ctx.get('goals')
          if (goalService && typeof goalService.get === 'function') {
            const goal = goalService.get(agent)
            if (goal && (goal.phase === 'active')) {
              goalId = goal.id
            }
          }
        } catch { /* goal service not available */ }

        taskUnit = { taskUnitId: ulid(), goalId, turns: 0 }
        agentTaskUnits.set(agent.id, taskUnit)
      }

      agentTools.set(agent.id, {
        tools: [], sessionId: agent.id, stepCount: 0, injectedThisTurn: false,
        taskUnitId: taskUnit.taskUnitId, goalId: taskUnit.goalId,
      })
    }
    agentTools.get(agent.id)!.tools.push({
      name: exec.name,
      success: !result.isError,
    })

    log(`tool/result — ${exec.name} ${result.isError ? 'FAIL' : 'OK'}`)
  })

  // --- Layer 1 + 4: On turn-stopping, score the turn and store it ---
  ctx.on('agent/turn-stopping', async (payload: { agent: Agent; turn: number; signal: AbortSignal }) => {
    log(`agent/turn-stopping fired — turn=${payload.turn}`)
    const { agent, turn } = payload
    const entry = agentTools.get(agent.id)

    if (!entry || entry.tools.length === 0) {
      log(`turn-stopping: no tools tracked for agent ${agent.id}, skipping (P-B: no-tool turns not stored)`)
      return
    }

    // P-B: Low-value filtering — skip pure Q&A turns (1-2 steps, all success, no failures)
    // These are simple lookups or chitchat that don't produce reusable experience
    const stepCountForFilter = Math.max(entry.stepCount, 1)
    const hasFailuresForFilter = entry.tools.some(t => !t.success)
    const difficultyForFilter = computeDifficulty(stepCountForFilter, hasFailuresForFilter)
    if (difficultyForFilter === 'low' && entry.tools.length <= 2) {
      log(`turn-stopping: low-value turn (P-B: ${entry.tools.length} tools, ${stepCountForFilter} steps, difficulty=low), skipping storage`)
      agentTools.delete(agent.id)
      return
    }

    // Score the turn
    const toolCallCount = entry.tools.length
    const successCount = entry.tools.filter(t => t.success).length
    const toolSuccessRate = toolCallCount > 0 ? successCount / toolCallCount : 0

    // P0: Step count — number of distinct steps in this turn
    // We track it via the pre-step injection (each pre-step = one step)
    const stepCount = Math.max(entry.stepCount, 1)

    // P0: Step efficiency
    const stepEfficiency = computeStepEfficiency(stepCount)

    // P0: Difficulty
    const hasFailures = entry.tools.some(t => !t.success)
    const difficulty = computeDifficulty(stepCount, hasFailures)

    // --- Goal progress: read from dsh goal service ---
    // P1: Prioritize ctx.get('goals') for web mode
    let goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none' = 'none'
    const goalService = ctx.get('goals')
    if (goalService && typeof goalService.get === 'function') {
      try {
        const goal = goalService.get(agent)
        if (goal) {
          if (goal.phase === 'complete') goalProgress = 'advanced'
          else if (goal.phase === 'blocked') goalProgress = 'stalled'
          else if (goal.phase === 'active') goalProgress = 'advanced'
          else if (goal.phase === 'paused') goalProgress = 'stalled'
        }
      } catch { /* goal service may not be available */ }
    }
    // Fallback if no goal service or no goal: use turn/end reason from session events
    if (goalProgress === 'none') {
      try {
        const events = agent.session.events ?? []
        const turnEndEvents = events.filter((e: any) => e.type === 'turn/end' && e.data?.turn === turn)
        const lastTurnEnd = turnEndEvents[turnEndEvents.length - 1]
        if (lastTurnEnd) {
          const reason = lastTurnEnd.data?.reason
          if (reason?.kind === 'completed') goalProgress = 'advanced'
          else if (reason?.kind === 'error') goalProgress = 'regressed'
          else if (reason?.kind === 'max-tokens') goalProgress = 'stalled'
          else if (reason?.kind === 'blocked') goalProgress = 'stalled'
          else if (reason?.kind === 'aborted') goalProgress = 'stalled'  // P1: aborted = negative
          else goalProgress = 'advanced' // unknown → assume advanced
        } else {
          goalProgress = toolSuccessRate >= 0.5 ? 'advanced' : 'stalled'
        }
      } catch {
        goalProgress = toolSuccessRate >= 0.5 ? 'advanced' : 'stalled'
      }
    }

    // --- Guard triggers: scan session events for repeat-tool-reminder injections ---
    let guardCount = 0
    try {
      const events = agent.session.events ?? []
      guardCount = events.filter((e: any) =>
        e.type === 'user/message' &&
        e.data?.source?.plugin === 'repeat-tool-reminder',
      ).length
    } catch { /* session events not available */ }

    // P1: Implicit negative feedback detection
    // Check for: user abort, user correction (step > 1 with user message after agent reply)
    let implicitNegative = false
    try {
      const events = agent.session.events ?? []
      // Check if turn ended due to abort
      const turnEndEvents = events.filter((e: any) => e.type === 'turn/end' && e.data?.turn === turn)
      const lastTurnEnd = turnEndEvents[turnEndEvents.length - 1]
      if (lastTurnEnd?.data?.reason?.kind === 'aborted') {
        implicitNegative = true
      }
      // Check for user correction: user messages after assistant in same turn
      if (stepCount > 1) {
        const userMsgsInTurn = events.filter((e: any) =>
          e.type === 'user/message' && e.data?.turn === turn &&
          e.data?.source?.plugin !== 'repeat-tool-reminder',
        )
        if (userMsgsInTurn.length > 0) {
          implicitNegative = true
        }
      }
    } catch { /* ignore */ }

    // --- User feedback: combine explicit + implicit (P1) ---
    let userFeedback: 'positive' | 'negative' | 'none' = 'none'
    const feedbackService = ctx.get('messageFeedback')
    if (feedbackService && typeof feedbackService.list === 'function') {
      try {
        const result = await feedbackService.list({ sessionId: agent.session.id })
        const items = (result as any)?.value?.items ?? (result as any)?.items ?? []
        if (Array.isArray(items) && items.length > 0) {
          const turnAssistantSeqs = new Set<number>()
          const events = agent.session.events ?? []
          for (const e of events) {
            if (e.type === 'assistant/message' && (e as any).data?.turn === turn) {
              turnAssistantSeqs.add((e as any).seq)
            }
          }
          const turnFeedback = items.filter((item: any) =>
            turnAssistantSeqs.has((item as any).messageSeq) ||
            turnAssistantSeqs.has((item as any).messageId),
          )
          if (turnFeedback.length > 0) {
            const hasNegative = turnFeedback.some((f: any) => f.rating === 'negative')
            const hasPositive = turnFeedback.some((f: any) => f.rating === 'positive')
            userFeedback = hasNegative ? 'negative' : (hasPositive ? 'positive' : 'none')
          }
        }
      } catch { /* feedback service may not be available */ }
    }
    // P1: Apply implicit negative if no explicit feedback
    if (userFeedback === 'none' && implicitNegative) {
      userFeedback = 'negative'
    }

    // P0+P1: Compute outcome score with new weights
    // goalProgress: 0.3, toolSuccess: 0.2, stepEfficiency: 0.25, guardPenalty: 0.15, feedback: 0.1
    const goalScore = goalProgress === 'advanced' ? 1.0 : goalProgress === 'stalled' ? 0.3 : goalProgress === 'regressed' ? 0.0 : 0.5
    const guardPenalty = Math.min(guardCount * 0.1, 0.15)
    const feedbackScore = userFeedback === 'positive' ? 1.0 : userFeedback === 'negative' ? 0.0 : 0.6  // P1: neutral = 0.6 (not 0.5)
    const outcomeScore = Math.max(0, Math.min(1,
      goalScore * 0.3 + toolSuccessRate * 0.2 + stepEfficiency * 0.25 + (0.15 - guardPenalty) + feedbackScore * 0.1,
    ))

    // Store the experience
    const toolsUsed = entry.tools.map(t => t.name)
    const actions = JSON.stringify({
      tools: entry.tools,
      goalProgress,
      feedback: userFeedback,
      stepCount,
      difficulty,
      stepEfficiency,
      implicitNegative,
    })
    const wsDigest = agent.options.cwd ? String(agent.options.cwd).slice(-32) : null

    // P5: Infer task pattern from first user message
    let taskPattern: string | null = null
    try {
      const events = agent.session.events ?? []
      const firstUserMsg = events.find((e: any) => e.type === 'user/message' && e.data?.turn === turn)
      const msgText = firstUserMsg?.data?.text ?? firstUserMsg?.data?.content ?? ''
      if (msgText) {
        taskPattern = inferTaskPattern(String(msgText))
      }

      // A1-a: Extract explicit preference from user message
      if (msgText) {
        const pref = extractPreference(String(msgText))
        if (pref) {
          const prefPath = getPreferencesFilePath(
            (config as any).dshHome || undefined,
          )
          const added = appendPreference(prefPath, pref)
          if (added) {
            log(`A1-a: preference extracted and saved: "${pref}"`)
          }
        }
      }
    } catch { /* ignore */ }

    const expId = store.store(
      agent.id, `turn-${turn}`, outcomeScore, userFeedback,
      toolsUsed, actions, wsDigest, difficulty, taskPattern,
      entry.taskUnitId, entry.goalId,
    )

    log(`turn ${turn} scored — score=${outcomeScore.toFixed(2)} | goal=${goalProgress} tools=${toolCallCount} successRate=${toolSuccessRate.toFixed(2)} steps=${stepCount} efficiency=${stepEfficiency.toFixed(2)} difficulty=${difficulty} task=${taskPattern ?? 'unknown'} guards=${guardCount} feedback=${userFeedback} implicitNeg=${implicitNegative} | exp ${expId}`)

    // P2: Synchronously generate lesson (don't wait for maintenance)
    if (config.metaCognitionEnabled) {
      pendingReflections.push({
        expId,
        actions,
        outcomeScore,
        userFeedback,
        toolsUsed,
        stepCount,
        difficulty,
      })
    }

    // Clean up agent tool tracking for next turn
    agentTools.delete(agent.id)

    // P-C: If goal completed, close the task unit
    if (goalProgress === 'advanced' && entry.goalId) {
      // Goal advanced/complete — close the task unit
      agentTaskUnits.delete(agent.id)
      log(`task unit ${entry.taskUnitId} closed (goal ${entry.goalId} advanced)`)
    }
  })

  // --- Layer 2: Inject experience at agent/pre-step ---
  // P0: Only inject on the first step of each turn, skip subsequent steps
  if (config.behaviorAdapterEnabled) {
    ctx.on('agent/pre-step', async (
      payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
      next: () => Promise<any>,
    ) => {
      const { agent, turn, step } = payload

      // P0: Track step count for this turn
      if (agentTools.has(agent.id)) {
        const entry = agentTools.get(agent.id)!
        entry.stepCount = Math.max(entry.stepCount, step)
      } else {
        agentTools.set(agent.id, {
          tools: [], sessionId: agent.id, stepCount: step, injectedThisTurn: false,
        })
      }

      // P0: Only inject once per turn (first step)
      const entry = agentTools.get(agent.id)!
      if (entry.injectedThisTurn || step > 1) {
        log(`agent/pre-step — turn=${turn} step=${step} (skipping injection, already injected this turn)`)
        return next()
      }

      log(`agent/pre-step — turn=${turn} step=${step} (injecting)`)

      try {
        // Query experience store for similar past turns
        const wsDigest = agent.options.cwd ? String(agent.options.cwd).slice(-32) : null

        // P5: Infer task pattern from current messages for better retrieval
        const firstMsg = payload.messages?.[0]
        const msgText = firstMsg && typeof firstMsg === 'object'
          ? String((firstMsg as any).content ?? (firstMsg as any).text ?? '')
          : ''
        const currentTaskPattern = msgText ? inferTaskPattern(msgText) : null

        // P5: Query with task pattern for better matching
        const records = store.query([], wsDigest, 10, config.minInjectionScore)

        // Always call next() first (waterfall contract: never short-circuit)
        const decision = await next()

        if (records.length > 0) {
          // P5: Sort by task pattern match, difficulty priority, then outcome score
          const sorted = [...records].sort((a, b) => {
            // P5: Same task pattern gets priority
            if (currentTaskPattern) {
              const aMatch = a.taskPattern === currentTaskPattern ? 1 : 0
              const bMatch = b.taskPattern === currentTaskPattern ? 1 : 0
              if (bMatch !== aMatch) return bMatch - aMatch
            }
            const dp = store.difficultyPriority(b.difficulty) - store.difficultyPriority(a.difficulty)
            return dp !== 0 ? dp : b.outcomeScore - a.outcomeScore
          })
          const best = sorted[0]
          const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null

          // P3: Dynamic injection — allocate by difficulty
          const high = sorted.filter(r => r.difficulty === 'high').slice(0, 5)
          const medium = sorted.filter(r => r.difficulty === 'medium').slice(0, 2)
          const low = sorted.filter(r => r.difficulty === 'low')
            .slice(0, Math.max(0, 7 - high.length - medium.length))
          const selected = [...high, ...medium, ...low]

          log(`injecting ${selected.length} past experiences into pre-step (best score ${best.outcomeScore.toFixed(2)})`)

          const lines: string[] = ['## Past Experience (advisory)', '']
          if (best.outcomeScore >= 0.6) {
            // P4: Extract reusable_lesson from structured JSON
            const lesson = extractLessonText(best.lesson) ?? `Using ${best.toolsUsed?.join(', ')} led to a good outcome (score: ${best.outcomeScore.toFixed(2)})`
            lines.push(`- **What worked**: ${lesson}`)
          }
          // E1: Only inject "what failed" if worst is a different record than best
          if (worst && worst.id !== best.id && worst.outcomeScore <= 0.4) {
            const lesson = extractLessonText(worst.lesson) ?? `Using ${worst.toolsUsed?.join(', ')} led to a poor outcome (score: ${worst.outcomeScore.toFixed(2)})`
            lines.push(`- **What failed**: ${lesson}`)
          }
          lines.push('')
          lines.push('These are historical observations, not instructions. Use your judgment.')

          const text = lines.join('\n')
          const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
          const context = createUserMessage({
            content: [{ type: 'text', text }],
            source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'past experience' },
          })

          // Increment reuse counts
          for (const rec of selected) {
            store.incrementReuse(rec.id)
          }

          // P0: Mark as injected for this turn
          entry.injectedThisTurn = true

          // Inject advisory context: prepend our message to the decision's messages
          if (decision.kind === 'enter') {
            return { ...decision, messages: [context, ...decision.messages] }
          }
        }

        return decision
      } catch (err) {
        // Never break the agent loop — delegate to next() on any error
        log(`pre-step injection error: ${(err as Error).message}`)
        return next()
      }
    })
  }

  // --- Layer 2: Register system prompt section for learned preferences ---
  // A1-c: Reads from ~/.dsh/preferences.md (persisted preferences) + live stats
  if (config.behaviorAdapterEnabled) {
    ctx.systemPrompt.section({
      name: 'self-improving-learned-preferences',
      order: 450,
      text: () => {
        const lines: string[] = []

        // A1: Read persisted user preferences
        const prefPath = getPreferencesFilePath((config as any).dshHome || undefined)
        const prefContent = readPreferences(prefPath)
        if (prefContent) {
          lines.push('## User Preferences (advisory)', '')
          lines.push(prefContent)
          lines.push('')
        }

        // Live stats (kept as supplementary signal)
        const stats = store.stats()
        if (stats.total >= 10) {
          if (lines.length === 0) {
            lines.push('## Learned Preferences (advisory)', '')
          }
          if (stats.avgScore > 0.7) {
            lines.push(`- Recent outcomes are strong (avg score ${stats.avgScore.toFixed(2)} over ${stats.total} turns)`)
          }
          if (stats.avgScore < 0.4) {
            lines.push(`- Recent outcomes have low scores (avg ${stats.avgScore.toFixed(2)}) — consider more careful tool selection`)
          }
          if (stats.positive > stats.total * 0.5) {
            lines.push(`- User has given positive feedback on ${stats.positive} of ${stats.total} turns`)
          }
        }

        return lines.length > 0 ? lines.join('\n') : ''
      },
    })
  }

  // --- Layer 4: Meta-cognition reflection queue ---
  interface PendingReflection {
    expId: string
    actions: string
    outcomeScore: number
    userFeedback: string
    toolsUsed: string[]
    stepCount?: number
    difficulty?: 'low' | 'medium' | 'high'
  }
  const pendingReflections: PendingReflection[] = []

  // Process reflections during maintenance
  // P2: Generates structured lesson JSON with full Reflection data (P4)
  // P2: Also merges fragmented lessons periodically
  ctx.on('agent/run-maintenance', async () => {
    if (pendingReflections.length > 0) {
      log(`processing ${pendingReflections.length} pending reflections`)
    }
    while (pendingReflections.length > 0) {
      const entry = pendingReflections.shift()!

      // Generate structured reflection (P2: actionable lesson, P4: JSON stored)
      const reflection = generateStructuredReflection(entry)
      store.updateLesson(entry.expId, reflection)
      log(`lesson generated — ${reflection.reusableLesson}`)

      // Boost confidence on similar past experiences if this was positive
      if (entry.outcomeScore >= 0.7) {
        const similar = store.query(entry.toolsUsed, null, 5, 0.6)
        for (const rec of similar) {
          if (rec.id !== entry.expId) {
            store.boostConfidence(rec.id)
          }
        }
      }
    }

    // C5: Merge fragmented lessons if enough have accumulated
    // Uses LLM if available (via ctx.llm), falls back to rule-based
    try {
      const groups = store.getUnmergedLessonGroups()
      if (groups.length > 0) {
        log(`merging ${groups.length} lesson groups`)
        for (const group of groups) {
          if (group.records.length < 2) continue
          // C5: Try LLM merge first, fall back to rule-based
          const mergedLesson = await llmMergeLessons(ctx, group.records)
          const sourceIds = group.records.map(r => r.id)
          const tools = group.records[0].toolsUsed ?? []
          store.mergeLessons(sourceIds, mergedLesson, group.records[0].difficulty as any, tools)
          log(`merged ${group.records.length} lessons for difficulty=${group.difficulty} tools=${group.toolsKey}`)
        }
      }
    } catch (err) {
      log(`lesson merge error: ${(err as Error).message}`)
    }

    // A1-b: LLM-based automatic preference distillation
    // Runs periodically during maintenance to extract high-confidence preferences
    try {
      const prefPath = getPreferencesFilePath((config as any).dshHome || undefined)
      const newPrefs = await distillPreferencesWithLLM(ctx, store, prefPath)
      if (newPrefs > 0) {
        log(`A1-b: distilled ${newPrefs} new auto-preferences`)
      }
    } catch (err) {
      log(`preference distillation error: ${(err as Error).message}`)
    }

    // Distill preferences + log stats
    const stats = store.stats()
    if (stats.total > 0) {
      log(`store stats — total=${stats.total} avgScore=${stats.avgScore.toFixed(2)} positive=${stats.positive} withLessons=${stats.withLessons} youngGen=${stats.youngGenCount} oldGen=${stats.oldGenCount} highDiff=${stats.highDifficultyCount} merged=${stats.mergedCount}`)
    }
  })

  // --- P5: GUI Settings Bridge ---
  // The dsh-self-improving-gui client plugin reads/writes through settingsScope
  // with namespace 'dsh-self-improving-gui'. We bridge requests here.
  // Note: 'settings' is NOT in our inject array (we don't want to hard-depend on it).
  // We try to access it dynamically; if it's not available, the bridge is simply skipped.
  try {
    const settingsService = (ctx as any).get?.('settings')
    if (settingsService && typeof settingsService.register === 'function') {
      const guiScope = settingsService.register('dsh-self-improving-gui', rulesSchema())

      // Push initial stats
      void guiScope.update({ stats: JSON.stringify(store.stats()) })

      // Watch for GUI requests (exportRequest, importData)
      guiScope.watch((next: any) => {
        // Handle export request
        if (next.exportRequest === 'all') {
          const exportData = store.exportAll()
          void guiScope.update({
            exportData: JSON.stringify(exportData),
            exportRequest: null,
          })
          log(`GUI export — sent ${exportData.length} records`)
        }

        // Handle import request
        if (next.importData) {
          try {
            const data = JSON.parse(next.importData)
            const result = store.importExperiences(data)
            void guiScope.update({
              importResult: JSON.stringify(result),
              importData: null,
              stats: JSON.stringify(store.stats()),
            })
            log(`GUI import — imported=${result.imported} skipped=${result.skipped} invalid=${result.invalid}`)
          } catch (e) {
            void guiScope.update({
              importResult: JSON.stringify({ imported: 0, skipped: 0, invalid: -1 }),
              importData: null,
            })
            log(`GUI import error: ${(e as Error).message}`)
          }
        }
      })
      log('GUI settings bridge active')
    }
  } catch {
    // 'settings' service not injected — GUI bridge disabled (headless mode)
  }

  // --- Cleanup ---
  ctx.effect(() => () => {
    store.close()
  })
}
