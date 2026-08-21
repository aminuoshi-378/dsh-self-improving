/**
 * Experience Store — Layer 3
 *
 * Cross-session persistent memory using SQLite.
 * Stores (context, action, outcome, lesson) tuples.
 *
 * Reuses the same SQLite infrastructure as dsh's session persistence,
 * but in a sidecar table — not part of the event log.
 */

import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { ulid } from 'ulid'
import type {
  ExperienceRecord,
  ExperienceQuery,
  TurnOutcome,
  Reflection,
} from '../types/index.js'

const MAX_RECORDS = 1000
const EVICTION_SCORE_THRESHOLD = 0.3

export class ExperienceStore {
  private db: DatabaseType

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initSchema()
  }

  // -------------------------------------------------------------------------
  // Schema initialization
  // -------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,

        context_hash TEXT NOT NULL,
        task_pattern TEXT,
        tools_used TEXT,
        workspace_digest TEXT,

        actions TEXT NOT NULL,

        outcome_score REAL,
        user_feedback TEXT,
        lesson TEXT,

        tags TEXT,
        confidence REAL DEFAULT 1.0,
        reuse_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_experiences_context ON experiences(context_hash);
      CREATE INDEX IF NOT EXISTS idx_experiences_task ON experiences(task_pattern);
      CREATE INDEX IF NOT EXISTS idx_experiences_score ON experiences(outcome_score DESC);
      CREATE INDEX IF NOT EXISTS idx_experiences_created ON experiences(created_at DESC);
    `)
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /**
   * Store a turn outcome as a new experience record.
   * Called by the Outcome Evaluator (Layer 1) after a turn ends.
   */
  store(outcome: TurnOutcome, context: {
    taskPattern: string | null
    toolsUsed: string[] | null
    workspaceDigest: string | null
    actions: string
    tags?: string[]
  }): string {
    const id = ulid()
    const contextHash = this.computeContextHash(
      context.taskPattern,
      context.toolsUsed,
      context.workspaceDigest,
    )

    const stmt = this.db.prepare(`
      INSERT INTO experiences (
        id, session_id, turn_id, created_at,
        context_hash, task_pattern, tools_used, workspace_digest,
        actions, outcome_score, user_feedback, lesson,
        tags, confidence, reuse_count
      ) VALUES (
        @id, @sessionId, @turnId, @createdAt,
        @contextHash, @taskPattern, @toolsUsed, @workspaceDigest,
        @actions, @outcomeScore, @userFeedback, @lesson,
        @tags, @confidence, @reuseCount
      )
    `)

    stmt.run({
      id,
      sessionId: outcome.sessionId,
      turnId: outcome.turnId,
      createdAt: outcome.timestamp,
      contextHash,
      taskPattern: context.taskPattern,
      toolsUsed: context.toolsUsed ? JSON.stringify(context.toolsUsed) : null,
      workspaceDigest: context.workspaceDigest,
      actions: context.actions,
      outcomeScore: outcome.outcomeScore,
      userFeedback: outcome.userFeedback,
      lesson: null,
      tags: context.tags ? JSON.stringify(context.tags) : null,
      confidence: 1.0,
      reuseCount: 0,
    })

    // Enforce retention limit
    this.enforceRetention()

    return id
  }

  /**
   * Update an experience record's lesson field after LLM reflection.
   * Called by the Meta-Cognition Engine (Layer 4).
   */
  updateLesson(id: string, reflection: Reflection): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET lesson = @lesson
      WHERE id = @id
    `)

    stmt.run({
      id,
      lesson: reflection.reusableLesson,
    })
  }

  /**
   * Increment reuse count and apply confidence decay.
   * Called by the Behavior Adapter (Layer 2) when an experience is injected.
   */
  incrementReuse(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET reuse_count = reuse_count + 1,
          confidence = MAX(0.1, 1.0 - (reuse_count + 1) * 0.1)
      WHERE id = @id
    `)

    stmt.run({ id })
  }

  /**
   * Re-validate an experience by boosting its confidence.
   * Called when a new positive outcome confirms a past lesson.
   */
  boostConfidence(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET confidence = MIN(1.0, confidence + 0.2)
      WHERE id = @id
    `)

    stmt.run({ id })
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /**
   * Retrieve experiences matching a query (fuzzy context matching).
   * Uses weighted similarity on task pattern + tools + workspace digest.
   */
  query(query: ExperienceQuery): ExperienceRecord[] {
    const limit = query.limit ?? 10
    const minScore = query.minScore ?? 0.0

    // Start with all records above min score, then rank by similarity
    let sql = `SELECT * FROM experiences WHERE outcome_score >= @minScore`
    const params: Record<string, unknown> = { minScore }

    if (query.taskPattern) {
      sql += ` AND (task_pattern = @taskPattern OR task_pattern IS NULL)`
      params.taskPattern = query.taskPattern
    }

    sql += ` ORDER BY outcome_score DESC, created_at DESC LIMIT @fetchLimit`
    params.fetchLimit = limit * 3 // fetch more, then re-rank by similarity

    const rows = this.db.prepare(sql).all(params) as RawExperienceRow[]
    const records = rows.map((r) => this.rowToRecord(r))

    // Re-rank by similarity score if we have context to match
    if (query.toolsUsed || query.workspaceDigest) {
      const ranked = records
        .map((rec) => ({
          rec,
          sim: this.similarityScore(rec, query),
        }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, limit)
        .map((item) => item.rec)
      return ranked
    }

    return records.slice(0, limit)
  }

  /**
   * Get a single experience by ID.
   */
  getById(id: string): ExperienceRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM experiences WHERE id = ?',
    ).get(id) as RawExperienceRow | undefined

    return row ? this.rowToRecord(row) : null
  }

  /**
   * Get the total count of stored experiences.
   */
  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM experiences',
    ).get() as { cnt: number }
    return row.cnt
  }

  /**
   * Get statistics about stored experiences.
   */
  stats(): {
    total: number
    avgScore: number
    positiveCount: number
    negativeCount: number
    withLessons: number
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(outcome_score), 0) as avgScore,
        SUM(CASE WHEN user_feedback = 'positive' THEN 1 ELSE 0 END) as positiveCount,
        SUM(CASE WHEN user_feedback = 'negative' THEN 1 ELSE 0 END) as negativeCount,
        SUM(CASE WHEN lesson IS NOT NULL THEN 1 ELSE 0 END) as withLessons
      FROM experiences
    `).get() as {
      total: number
      avgScore: number
      positiveCount: number
      negativeCount: number
      withLessons: number
    }

    return {
      total: row.total,
      avgScore: row.avgScore,
      positiveCount: row.positiveCount ?? 0,
      negativeCount: row.negativeCount ?? 0,
      withLessons: row.withLessons ?? 0,
    }
  }

  // -------------------------------------------------------------------------
  // Eviction
  // -------------------------------------------------------------------------

  /**
   * Retain the most recent MAX_RECORDS experiences.
   * Evict by combined score of outcome_score and recency.
   * Experiences with outcome_score < EVICTION_SCORE_THRESHOLD and reuse_count == 0
   * are evicted first.
   */
  private enforceRetention(): void {
    const count = this.count()
    if (count <= MAX_RECORDS) return

    const toEvict = count - MAX_RECORDS

    // First pass: evict low-score, never-reused records
    const lowScoreStmt = this.db.prepare(`
      DELETE FROM experiences
      WHERE id IN (
        SELECT id FROM experiences
        WHERE outcome_score < ${EVICTION_SCORE_THRESHOLD}
          AND reuse_count = 0
        ORDER BY outcome_score ASC, created_at ASC
        LIMIT @toEvict
      )
    `)
    lowScoreStmt.run({ toEvict })

    // Second pass: if still over limit, evict by combined score (low score + old)
    const remaining = this.count()
    if (remaining > MAX_RECORDS) {
      const extra = remaining - MAX_RECORDS
      const stmt = this.db.prepare(`
        DELETE FROM experiences
        WHERE id IN (
          SELECT id FROM experiences
          ORDER BY (outcome_score * 0.5 + (CAST(strftime('%s', 'now') AS REAL) - created_at) * 0.0000001) DESC
          LIMIT @extra
        )
      `)
      stmt.run({ extra })
    }
  }

  // -------------------------------------------------------------------------
  // Context hashing and similarity
  // -------------------------------------------------------------------------

  /**
   * Compute a context hash for similarity matching.
   * Combines task pattern + sorted tools + workspace digest.
   */
  computeContextHash(
    taskPattern: string | null,
    toolsUsed: string[] | null,
    workspaceDigest: string | null,
  ): string {
    const parts = [
      taskPattern ?? '',
      toolsUsed ? [...toolsUsed].sort().join(',') : '',
      workspaceDigest ?? '',
    ]
    return parts.join('|')
  }

  /**
   * Compute a similarity score between an experience record and a query.
   * Returns 0.0–1.0 where 1.0 is a perfect match.
   */
  private similarityScore(rec: ExperienceRecord, query: ExperienceQuery): number {
    let score = 0.0
    let weightSum = 0.0

    // Task pattern matching (weight: 0.4)
    if (query.taskPattern && rec.taskPattern) {
      weightSum += 0.4
      if (rec.taskPattern === query.taskPattern) {
        score += 0.4
      } else if (
        rec.taskPattern.includes(query.taskPattern) ||
        query.taskPattern.includes(rec.taskPattern)
      ) {
        score += 0.2
      }
    }

    // Tools overlap (weight: 0.3)
    if (query.toolsUsed && rec.toolsUsed) {
      weightSum += 0.3
      const querySet = new Set(query.toolsUsed)
      const recSet = new Set(rec.toolsUsed)
      const intersection = [...querySet].filter((t) => recSet.has(t)).length
      const union = new Set([...querySet, ...recSet]).size
      if (union > 0) {
        score += 0.3 * (intersection / union)
      }
    }

    // Workspace digest (weight: 0.3)
    if (query.workspaceDigest && rec.workspaceDigest) {
      weightSum += 0.3
      if (rec.workspaceDigest === query.workspaceDigest) {
        score += 0.3
      }
    }

    // Normalize to 0.0–1.0
    return weightSum > 0 ? score / weightSum : 0.5
  }

  // -------------------------------------------------------------------------
  // Row ↔ Record conversion
  // -------------------------------------------------------------------------

  private rowToRecord(row: RawExperienceRow): ExperienceRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      createdAt: row.created_at,
      contextHash: row.context_hash,
      taskPattern: row.task_pattern,
      toolsUsed: row.tools_used ? JSON.parse(row.tools_used) : null,
      workspaceDigest: row.workspace_digest,
      actions: row.actions,
      outcomeScore: row.outcome_score,
      userFeedback: row.user_feedback,
      lesson: row.lesson,
      tags: row.tags ? JSON.parse(row.tags) : null,
      confidence: row.confidence,
      reuseCount: row.reuse_count,
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close()
  }

  /**
   * Clear all experiences (for testing).
   */
  clear(): void {
    this.db.exec('DELETE FROM experiences')
  }
}

interface RawExperienceRow {
  id: string
  session_id: string
  turn_id: string
  created_at: number
  context_hash: string
  task_pattern: string | null
  tools_used: string | null
  workspace_digest: string | null
  actions: string
  outcome_score: number
  user_feedback: string
  lesson: string | null
  tags: string | null
  confidence: number
  reuse_count: number
}
