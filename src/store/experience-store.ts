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
import { createHash } from 'node:crypto'
import type {
  ExperienceRecord,
  ExperienceQuery,
  TurnOutcome,
  Reflection,
  ExportedExperience,
} from '../types/index.js'
import { isValidImportedExperience } from '../types/index.js'

const YOUNG_GEN_MAX = 200
const OLD_GEN_MAX = 800
const LESSON_MERGE_THRESHOLD = 20

// A2: TTL — experiences not injected in TTL_DAYS get downgraded (old gen) or evicted
const TTL_DAYS = 30
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000

// A5: Active forgetting — threshold for proactively cleaning low-value experiences
const FORGET_SCORE_THRESHOLD = 0.3
const FORGET_CONFIDENCE_THRESHOLD = 0.2

export class ExperienceStore {
  private db: DatabaseType

  constructor(dbPath: string = ':memory:') {
    const resolvedPath = dbPath.startsWith('~/')
      ? dbPath.replace('~/', `${process.env.HOME}/`)
      : dbPath
    if (resolvedPath !== ':memory:') {
      const dir = resolvedPath.replace(/\/[^/]+$/, '')
      try { require('node:fs').mkdirSync(dir, { recursive: true }) } catch {}
    }
    this.db = new Database(resolvedPath)
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

        task_unit_id TEXT NOT NULL DEFAULT '',
        goal_id TEXT,

        context_hash TEXT NOT NULL,
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

        tags TEXT,
        confidence REAL DEFAULT 1.0,
        reuse_count INTEGER DEFAULT 0,
        source TEXT DEFAULT 'model-inferred'
      );
    `)

    // Migration: add columns that may not exist in older databases
    this.ensureColumn('difficulty', "TEXT DEFAULT 'medium'")
    this.ensureColumn('generation', 'INTEGER DEFAULT 0')
    this.ensureColumn('last_injected_at', 'INTEGER')
    this.ensureColumn('merged', 'INTEGER DEFAULT 0')
    this.ensureColumn('tags', 'TEXT')
    this.ensureColumn('task_unit_id', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('goal_id', 'TEXT')
    this.ensureColumn('content_hash', 'TEXT')
    this.ensureColumn('source', "TEXT DEFAULT 'model-inferred'")

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_experiences_context ON experiences(context_hash);
      CREATE INDEX IF NOT EXISTS idx_experiences_task ON experiences(task_pattern);
      CREATE INDEX IF NOT EXISTS idx_experiences_score ON experiences(outcome_score DESC);
      CREATE INDEX IF NOT EXISTS idx_experiences_created ON experiences(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_experiences_difficulty ON experiences(difficulty);
      CREATE INDEX IF NOT EXISTS idx_experiences_generation ON experiences(generation);
      CREATE INDEX IF NOT EXISTS idx_experiences_merged ON experiences(merged);
      CREATE INDEX IF NOT EXISTS idx_experiences_task_unit ON experiences(task_unit_id);
      CREATE INDEX IF NOT EXISTS idx_experiences_goal ON experiences(goal_id);
      CREATE INDEX IF NOT EXISTS idx_experiences_content_hash ON experiences(content_hash);
    `)

    // A3: FTS5 full-text index on lesson and actions for BM25 search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(
        lesson, actions, content='experiences', content_rowid='rowid'
      );
    `)
    // Triggers to keep FTS5 in sync with the experiences table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS experiences_ai AFTER INSERT ON experiences BEGIN
        INSERT INTO experiences_fts(rowid, lesson, actions)
        VALUES (new.rowid, COALESCE(new.lesson, ''), new.actions);
      END;
      CREATE TRIGGER IF NOT EXISTS experiences_ad AFTER DELETE ON experiences BEGIN
        INSERT INTO experiences_fts(experiences_fts, rowid, lesson, actions)
        VALUES ('delete', old.rowid, COALESCE(old.lesson, ''), old.actions);
      END;
      CREATE TRIGGER IF NOT EXISTS experiences_au AFTER UPDATE ON experiences BEGIN
        INSERT INTO experiences_fts(experiences_fts, rowid, lesson, actions)
        VALUES ('delete', old.rowid, COALESCE(old.lesson, ''), old.actions);
        INSERT INTO experiences_fts(rowid, lesson, actions)
        VALUES (new.rowid, COALESCE(new.lesson, ''), new.actions);
      END;
    `)

    // A3: Atomic facts table — structured facts that never expire
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS atomic_facts (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        source TEXT DEFAULT 'model-inferred',
        confidence REAL DEFAULT 0.5,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        evicted INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON atomic_facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate ON atomic_facts(predicate);
    `)
    // FTS5 for atomic facts
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS atomic_facts_fts USING fts5(
        subject, object, content='atomic_facts', content_rowid='rowid'
      );
    `)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON atomic_facts BEGIN
        INSERT INTO atomic_facts_fts(rowid, subject, object)
        VALUES (new.rowid, new.subject, new.object);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON atomic_facts BEGIN
        INSERT INTO atomic_facts_fts(atomic_facts_fts, rowid, subject, object)
        VALUES ('delete', old.rowid, old.subject, old.object);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON atomic_facts BEGIN
        INSERT INTO atomic_facts_fts(atomic_facts_fts, rowid, subject, object)
        VALUES ('delete', old.rowid, old.subject, old.object);
        INSERT INTO atomic_facts_fts(rowid, subject, object)
        VALUES (new.rowid, new.subject, new.object);
      END;
    `)
  }

  /** Add a column to the experiences table if it doesn't already exist (migration support). */
  private ensureColumn(columnName: string, definition: string): void {
    const cols = this.db.prepare('PRAGMA table_info(experiences)').all() as { name: string }[]
    if (!cols.some((c) => c.name === columnName)) {
      this.db.exec(`ALTER TABLE experiences ADD COLUMN ${columnName} ${definition}`)
    }
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
    taskUnitId?: string
    goalId?: string | null
    tags?: string[]
  }): string {
    const id = ulid()
    const taskUnitId = context.taskUnitId ?? id
    const contextHash = this.computeContextHash(
      context.taskPattern,
      context.toolsUsed,
      context.workspaceDigest,
    )
    // E2: content_hash — sha1 of ordered tool call sequence (with success/failure) + workspace
    const contentHash = this.computeContentHash(context.actions, context.workspaceDigest) ?? null

    const stmt = this.db.prepare(`
      INSERT INTO experiences (
        id, session_id, turn_id, created_at,
        task_unit_id, goal_id,
        context_hash, task_pattern, tools_used, workspace_digest,
        actions, outcome_score, user_feedback, lesson,
        difficulty, generation, last_injected_at, merged,
        tags, confidence, reuse_count, content_hash
      ) VALUES (
        @id, @sessionId, @turnId, @createdAt,
        @taskUnitId, @goalId,
        @contextHash, @taskPattern, @toolsUsed, @workspaceDigest,
        @actions, @outcomeScore, @userFeedback, @lesson,
        @difficulty, @generation, @lastInjectedAt, @merged,
        @tags, @confidence, @reuseCount, @contentHash
      )
    `)

    stmt.run({
      id,
      sessionId: outcome.sessionId,
      turnId: outcome.turnId,
      createdAt: outcome.timestamp,
      taskUnitId,
      goalId: context.goalId ?? null,
      contextHash,
      taskPattern: context.taskPattern,
      toolsUsed: context.toolsUsed ? JSON.stringify(context.toolsUsed) : null,
      workspaceDigest: context.workspaceDigest,
      actions: context.actions,
      outcomeScore: outcome.outcomeScore,
      userFeedback: outcome.userFeedback,
      lesson: null,
      difficulty: outcome.difficulty,
      generation: 0,
      lastInjectedAt: null,
      merged: 0,
      tags: context.tags ? JSON.stringify(context.tags) : null,
      confidence: 1.0,
      reuseCount: 0,
      contentHash,
    })

    // Enforce retention limit
    this.enforceRetention()

    return id
  }

  /**
   * Update an experience record's lesson field after LLM reflection.
   * Called by the Meta-Cognition Engine (Layer 4).
   */
  /**
   * Update an experience record's lesson field after LLM reflection.
   * Stores the full Reflection as JSON (P4: structured information).
   * Falls back to plain text for legacy consumers.
   */
  updateLesson(id: string, reflection: Reflection): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET lesson = @lesson
      WHERE id = @id
    `)

    stmt.run({
      id,
      lesson: JSON.stringify(reflection),
    })
  }

  /**
   * Update lesson with a plain text string (legacy / rule-based fallback).
   */
  updateLessonText(id: string, lessonText: string): void {
    this.db.prepare('UPDATE experiences SET lesson = ? WHERE id = ?').run(lessonText, id)
  }

  /**
   * Increment reuse count and apply confidence decay.
   * Called by the Behavior Adapter (Layer 2) when an experience is injected.
   */
  incrementReuse(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET reuse_count = reuse_count + 1,
          confidence = MAX(0.1, 1.0 - (reuse_count + 1) * 0.1),
          last_injected_at = @now
      WHERE id = @id
    `)

    stmt.run({ id, now: Date.now() })
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
  /**
   * Retrieve experiences using two-stage recall (P4).
   * Stage 1 (coarse): SQL filter by context_hash + tools_used intersection + minScore.
   * Stage 2 (fine): Re-rank by composite score = outcome_score * 0.4 + tools_similarity * 0.3 + recency * 0.3.
   * Deduplicates by context_hash, keeping only the newest for each (P0).
   * Difficulty-aware: high difficulty experiences prioritized (P0).
   */
  query(query: ExperienceQuery): ExperienceRecord[] {
    const limit = query.limit ?? 10
    const minScore = query.minScore ?? 0.0

    // Dynamic candidate set sizing (P4)
    const totalCount = this.count()
    let coarseLimit: number
    if (totalCount < 50) {
      coarseLimit = Math.max(limit * 5, 50)
    } else if (totalCount < 200) {
      coarseLimit = 20
    } else {
      coarseLimit = 50
    }

    // Stage 1: Coarse filter
    let rows: RawExperienceRow[]

    if (query.searchText) {
      // A3: FTS5 + BM25 search — match keywords in lesson/actions, order by relevance
      try {
        // FTS5 MATCH query: escape special chars by wrapping each term in quotes
        const safeQuery = query.searchText
          .split(/[\s,]+/)
          .filter((t) => t.length > 0)
          .map((t) => `"${t.replace(/"/g, '""')}"`)
          .join(' ')
        if (safeQuery) {
          const ftsRows = this.db.prepare(`
            SELECT e.* FROM experiences e
            JOIN experiences_fts f ON e.rowid = f.rowid
            WHERE experiences_fts MATCH @matchText
              AND e.outcome_score >= @minScore
              AND e.merged = 0
            ORDER BY bm25(experiences_fts) ASC
            LIMIT @fetchLimit
          `).all({ matchText: safeQuery, minScore, fetchLimit: coarseLimit }) as RawExperienceRow[]
          rows = ftsRows
        } else {
          rows = this.db.prepare(`
            SELECT * FROM experiences WHERE outcome_score >= @minScore AND merged = 0
            ORDER BY outcome_score DESC, created_at DESC LIMIT @fetchLimit
          `).all({ minScore, fetchLimit: coarseLimit }) as RawExperienceRow[]
        }
      } catch {
        // FTS5 not available or query syntax error — fall back to SQL filter
        rows = this.db.prepare(`
          SELECT * FROM experiences WHERE outcome_score >= @minScore AND merged = 0
          ORDER BY outcome_score DESC, created_at DESC LIMIT @fetchLimit
        `).all({ minScore, fetchLimit: coarseLimit }) as RawExperienceRow[]
      }
    } else {
      // Standard coarse filter via SQL
      let sql = `SELECT * FROM experiences WHERE outcome_score >= @minScore AND merged = 0`
      const params: Record<string, unknown> = { minScore }

      if (query.taskPattern) {
        sql += ` AND (task_pattern = @taskPattern OR task_pattern IS NULL)`
        params.taskPattern = query.taskPattern
      }

      sql += ` ORDER BY outcome_score DESC, created_at DESC LIMIT @fetchLimit`
      params.fetchLimit = coarseLimit

      rows = this.db.prepare(sql).all(params) as RawExperienceRow[]
    }

    const records = rows.map((r) => this.rowToRecord(r))

    // P0: Deduplicate by context_hash — keep only the newest for each
    const deduped = this.deduplicateByContextHash(records)

    // Stage 2: Fine re-ranking if we have context to match
    let ranked: ExperienceRecord[]
    if (query.toolsUsed || query.workspaceDigest) {
      ranked = deduped
        .map((rec) => ({
          rec,
          rank: this.compositeRank(rec, query),
        }))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map((item) => item.rec)
    } else {
      // Without context, sort by difficulty priority then score (P0)
      ranked = deduped
        .sort((a, b) => {
          const diffPriority = this.difficultyPriority(b.difficulty) - this.difficultyPriority(a.difficulty)
          if (diffPriority !== 0) return diffPriority
          return b.outcomeScore - a.outcomeScore
        })
        .slice(0, limit)
    }

    return ranked
  }

  /**
   * E2/P0: Deduplicate records by content_hash (preferred) or context_hash (fallback).
   * For records sharing the same hash, keep only the best one (highest score, then newest).
   */
  private deduplicateByContextHash(records: ExperienceRecord[]): ExperienceRecord[] {
    const seen = new Map<string, ExperienceRecord>()
    for (const rec of records) {
      // Prefer content_hash if available, fall back to context_hash
      const hash = rec.contentHash ?? rec.contextHash
      const existing = seen.get(hash)
      if (!existing) {
        seen.set(hash, rec)
      } else {
        // Keep the one with higher score, then newer
        if (rec.outcomeScore > existing.outcomeScore ||
            (rec.outcomeScore === existing.outcomeScore && rec.createdAt > existing.createdAt)) {
          seen.set(hash, rec)
        }
      }
    }
    return [...seen.values()]
  }

  /**
   * P0: Difficulty priority for injection ordering.
   * high = 3, medium = 2, low = 1.
   * High difficulty experiences are prioritized; low only fills when not enough.
   */
  private difficultyPriority(difficulty: string): number {
    switch (difficulty) {
      case 'high': return 3
      case 'medium': return 2
      case 'low': return 1
      default: return 2
    }
  }

  /**
   * P4: Composite rank for fine re-ranking.
   * outcome_score * 0.4 + tools_similarity * 0.3 + recency * 0.3
   */
  private compositeRank(rec: ExperienceRecord, query: ExperienceQuery): number {
    const scoreComponent = rec.outcomeScore * 0.4
    const simComponent = this.similarityScore(rec, query) * 0.3
    // Recency: more recent = higher (normalize to 0-1 using exponential decay over 30 days)
    const ageMs = Date.now() - rec.createdAt
    const recencyComponent = Math.exp(-ageMs / (30 * 24 * 60 * 60 * 1000)) * 0.3
    return scoreComponent + simComponent + recencyComponent
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
    youngGenCount: number
    oldGenCount: number
    highDifficultyCount: number
    mergedCount: number
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(outcome_score), 0) as avgScore,
        SUM(CASE WHEN user_feedback = 'positive' THEN 1 ELSE 0 END) as positiveCount,
        SUM(CASE WHEN user_feedback = 'negative' THEN 1 ELSE 0 END) as negativeCount,
        SUM(CASE WHEN lesson IS NOT NULL THEN 1 ELSE 0 END) as withLessons,
        SUM(CASE WHEN generation = 0 THEN 1 ELSE 0 END) as youngGenCount,
        SUM(CASE WHEN generation = 1 THEN 1 ELSE 0 END) as oldGenCount,
        SUM(CASE WHEN difficulty = 'high' THEN 1 ELSE 0 END) as highDifficultyCount,
        SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as mergedCount
      FROM experiences
    `).get() as {
      total: number
      avgScore: number
      positiveCount: number
      negativeCount: number
      withLessons: number
      youngGenCount: number
      oldGenCount: number
      highDifficultyCount: number
      mergedCount: number
    }

    return {
      total: row.total,
      avgScore: row.avgScore,
      positiveCount: row.positiveCount ?? 0,
      negativeCount: row.negativeCount ?? 0,
      withLessons: row.withLessons ?? 0,
      youngGenCount: row.youngGenCount ?? 0,
      oldGenCount: row.oldGenCount ?? 0,
      highDifficultyCount: row.highDifficultyCount ?? 0,
      mergedCount: row.mergedCount ?? 0,
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
  /**
   * P3: Generational GC — young gen + old gen dual-region management.
   *
   * Young Gen (generation=0): max YOUNG_GEN_MAX records.
   *   - Minor GC when over capacity: evict low quality (low score, no lesson, low difficulty)
   *   - Survivors (reused or score>=0.8 or has lesson) promoted to old gen
   *
   * Old Gen (generation=1): max OLD_GEN_MAX records.
   *   - Major GC when over capacity: evict by quality priority
   *     Priority: difficulty=low > no lesson > score<0.5 > merged=true
   *     Never evict: difficulty=high with lesson
   */
  private enforceRetention(): void {
    // A5: Active forgetting — proactively clean low-value, low-confidence experiences
    // Runs before generational GC to remove noise independent of capacity pressure
    this.activeForget()

    // A2: TTL — downgrade stale old-gen experiences to young gen if not injected in TTL_DAYS
    // This gives stale experiences a chance to be re-evaluated (and possibly evicted in next Minor GC)
    this.applyTTL()

    // --- Minor GC: young generation ---
    const youngCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM experiences WHERE generation = 0',
    ).get() as { c: number }).c

    if (youngCount > YOUNG_GEN_MAX) {
      // Promote survivors first
      this.promoteYoungGen()

      // Then evict low quality from young gen
      const toEvict = youngCount - YOUNG_GEN_MAX
      this.db.prepare(`
        DELETE FROM experiences
        WHERE id IN (
          SELECT id FROM experiences
          WHERE generation = 0
            AND merged = 0
          ORDER BY
            CASE WHEN difficulty = 'low' THEN 0 ELSE 1 END,
            CASE WHEN lesson IS NULL THEN 0 ELSE 1 END,
            outcome_score ASC,
            created_at ASC
          LIMIT @toEvict
        )
      `).run({ toEvict })
    }

    // --- Major GC: old generation ---
    const oldCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM experiences WHERE generation = 1',
    ).get() as { c: number }).c

    if (oldCount > OLD_GEN_MAX) {
      const toEvict = oldCount - OLD_GEN_MAX
      // Evict by quality priority, but never evict high difficulty with lesson
      this.db.prepare(`
        DELETE FROM experiences
        WHERE id IN (
          SELECT id FROM experiences
          WHERE generation = 1
            AND NOT (difficulty = 'high' AND lesson IS NOT NULL)
          ORDER BY
            CASE WHEN difficulty = 'low' THEN 0 ELSE 1 END,
            CASE WHEN lesson IS NULL THEN 0 ELSE 1 END,
            CASE WHEN outcome_score < 0.5 THEN 0 ELSE 1 END,
            CASE WHEN merged = 1 THEN 0 ELSE 1 END,
            outcome_score ASC,
            created_at ASC
          LIMIT @toEvict
        )
      `).run({ toEvict })

      // If still over (all remaining are high-difficulty with lessons), evict lowest score
      const remainingOld = (this.db.prepare(
        'SELECT COUNT(*) as c FROM experiences WHERE generation = 1',
      ).get() as { c: number }).c
      if (remainingOld > OLD_GEN_MAX) {
        this.db.prepare(`
          DELETE FROM experiences
          WHERE id IN (
            SELECT id FROM experiences
            WHERE generation = 1
            ORDER BY outcome_score ASC
            LIMIT @extra
          )
        `).run({ extra: remainingOld - OLD_GEN_MAX })
      }
    }
  }

  /**
   * P3: Promote qualified young gen experiences to old gen.
   * Conditions: reuse_count >= 1, OR score >= 0.8 with lesson, OR merged product.
   */
  private promoteYoungGen(): void {
    this.db.prepare(`
      UPDATE experiences
      SET generation = 1
      WHERE generation = 0
        AND (reuse_count >= 1 OR (outcome_score >= 0.8 AND lesson IS NOT NULL) OR merged = 1)
    `).run()
  }

  /**
   * A5: Active forgetting — proactively clean low-value, low-confidence experiences.
   * Unlike passive GC (capacity-triggered), this runs on every store() call
   * and removes clearly worthless records regardless of capacity.
   * Criteria: score < 0.3 AND confidence < 0.2 AND no lesson AND difficulty = low
   * Never deletes high-difficulty or lesson-bearing records.
   */
  private activeForget(): void {
    const result = this.db.prepare(`
      DELETE FROM experiences
      WHERE outcome_score < @scoreThreshold
        AND confidence < @confidenceThreshold
        AND lesson IS NULL
        AND difficulty = 'low'
        AND merged = 0
    `).run({ scoreThreshold: FORGET_SCORE_THRESHOLD, confidenceThreshold: FORGET_CONFIDENCE_THRESHOLD })
    if (result.changes > 0) {
      // Could log here if needed
    }
  }

  /**
   * A2: TTL expiry — downgrade old-gen experiences not injected in TTL_DAYS to young gen.
   * This lets stale experiences re-enter the Minor GC cycle and potentially get evicted.
   * High-difficulty experiences with lessons are exempt (knowledge may still be valuable even if stale).
   */
  private applyTTL(): void {
    const cutoff = Date.now() - TTL_MS
    this.db.prepare(`
      UPDATE experiences
      SET generation = 0
      WHERE generation = 1
        AND (last_injected_at IS NULL OR last_injected_at < @cutoff)
        AND created_at < @cutoff
        AND NOT (difficulty = 'high' AND lesson IS NOT NULL)
    `).run({ cutoff })
  }

  /**
   * P3: Promote a specific experience to old gen (e.g. after LLM merge).
   */
  promoteToOldGen(id: string): void {
    this.db.prepare('UPDATE experiences SET generation = 1 WHERE id = ?').run(id)
  }

  /**
   * P3: Mark a record as merged.
   */
  markMerged(id: string): void {
    this.db.prepare('UPDATE experiences SET merged = 1 WHERE id = ?').run(id)
  }

  /**
   * Delete a record by id.
   * Used by memory benchmark tests (selective forgetting).
   */
  deleteById(id: string): boolean {
    const result = this.db.prepare('DELETE FROM experiences WHERE id = ?').run(id)
    return result.changes > 0
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
   * E2: Compute a content hash from the actions JSON (ordered tool sequence + success/failure).
   * Input: actions JSON string ({tools: [{name, success}], ...}) + workspace digest.
   * The tool sequence is ordered (not sorted) — call order is semantic.
   * goalProgress/feedback are results, not content, so they're excluded.
   * Returns null if actions isn't valid JSON with a tools array (fallback to context_hash for dedup).
   */
  computeContentHash(actions: string, workspaceDigest: string | null): string | null {
    try {
      const parsed = JSON.parse(actions)
      const tools = (parsed.tools ?? []) as { name: string; success: boolean }[]
      if (!Array.isArray(tools) || tools.length === 0) return null
      // Format: toolName:success,toolName:success,...|workspace
      const toolStr = tools.map((t) => `${t.name}:${t.success}`).join(',')
      const input = `${toolStr}|${workspaceDigest ?? ''}`
      return createHash('sha1').update(input).digest('hex').slice(0, 16)
    } catch {
      // If actions isn't valid JSON, return null to fall back to context_hash dedup
      return null
    }
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
      taskUnitId: row.task_unit_id || row.id,
      goalId: row.goal_id ?? null,
      contextHash: row.context_hash,
      contentHash: row.content_hash ?? null,
      taskPattern: row.task_pattern,
      toolsUsed: row.tools_used ? JSON.parse(row.tools_used) : null,
      workspaceDigest: row.workspace_digest,
      actions: row.actions,
      outcomeScore: row.outcome_score,
      userFeedback: row.user_feedback,
      lesson: row.lesson,
      difficulty: (row.difficulty as 'low' | 'medium' | 'high') ?? 'medium',
      generation: row.generation ?? 0,
      lastInjectedAt: row.last_injected_at ?? null,
      merged: Boolean(row.merged),
      tags: row.tags ? JSON.parse(row.tags) : null,
      confidence: row.confidence,
      reuseCount: row.reuse_count,
    }
  }

  // -------------------------------------------------------------------------
  // P2: Lesson merging
  // -------------------------------------------------------------------------

  /**
   * Get unmerged lessons grouped by difficulty + tool similarity.
   * Returns groups suitable for LLM-based merging.
   */
  getUnmergedLessonGroups(threshold: number = LESSON_MERGE_THRESHOLD): {
    difficulty: string
    toolsKey: string
    records: ExperienceRecord[]
  }[] {
    const unmergedCount = (this.db.prepare(
      `SELECT COUNT(*) as c FROM experiences WHERE lesson IS NOT NULL AND merged = 0`,
    ).get() as { c: number }).c

    if (unmergedCount < threshold) return []

    const rows = this.db.prepare(`
      SELECT * FROM experiences
      WHERE lesson IS NOT NULL AND merged = 0
      ORDER BY difficulty DESC, created_at DESC
    `).all() as RawExperienceRow[]

    const records = rows.map((r) => this.rowToRecord(r))

    // Group by difficulty + sorted tools key
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

  /**
   * P2: Merge multiple lessons into a single consolidated lesson.
   * Marks old records as merged, creates a new record in old gen.
   */
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
    const contextHash = this.computeContextHash(null, toolsUsed, null)

    this.db.prepare(`
      INSERT INTO experiences (
        id, session_id, turn_id, created_at,
        context_hash, task_pattern, tools_used, workspace_digest,
        actions, outcome_score, user_feedback, lesson,
        difficulty, generation, last_injected_at, merged,
        tags, confidence, reuse_count
      ) VALUES (
        @id, @sessionId, @turnId, @createdAt,
        @contextHash, @taskPattern, @toolsUsed, @workspaceDigest,
        @actions, @outcomeScore, @userFeedback, @lesson,
        @difficulty, @generation, @lastInjectedAt, @merged,
        @tags, @confidence, @reuseCount
      )
    `).run({
      id,
      sessionId: 'merge',
      turnId: `merge-${Date.now()}`,
      createdAt: Date.now(),
      contextHash,
      taskPattern: null,
      toolsUsed: JSON.stringify(toolsUsed),
      workspaceDigest: null,
      actions: JSON.stringify({ merged_from: sourceIds }),
      outcomeScore: 0.85,
      userFeedback: 'none',
      lesson: JSON.stringify(mergedLesson),
      difficulty,
      generation: 1, // Merged products go directly to old gen
      lastInjectedAt: null,
      merged: 0,
      tags: JSON.stringify(['merged']),
      confidence: 1.0,
      reuseCount: 0,
    })

    // Mark source records as merged
    for (const sourceId of sourceIds) {
      this.markMerged(sourceId)
    }

    return id
  }

  // -------------------------------------------------------------------------
  // P5: Import / Export
  // -------------------------------------------------------------------------

  /**
   * P5: Export all experiences as an array of plain objects.
   * Used for backup, machine migration, and team sharing.
   */
  exportAll(): ExportedExperience[] {
    const rows = this.db.prepare(`
      SELECT * FROM experiences ORDER BY created_at ASC
    `).all() as RawExperienceRow[]

    return rows.map((r) => this.rowToRecord(r)).map((rec) => ({
      id: rec.id,
      outcomeScore: rec.outcomeScore,
      toolsUsed: rec.toolsUsed,
      lesson: rec.lesson,
      difficulty: rec.difficulty,
      taskPattern: rec.taskPattern,
      taskUnitId: rec.taskUnitId,
      goalId: rec.goalId,
      generation: rec.generation,
      merged: rec.merged,
      confidence: rec.confidence,
      reuseCount: rec.reuseCount,
      createdAt: rec.createdAt,
      actions: rec.actions,
    }))
  }

  /**
   * P5: Export filtered experiences by task pattern.
   */
  exportByTaskPattern(taskPattern: string): ExportedExperience[] {
    const rows = this.db.prepare(`
      SELECT * FROM experiences WHERE task_pattern = ? ORDER BY created_at ASC
    `).all(taskPattern) as RawExperienceRow[]

    return rows.map((r) => this.rowToRecord(r)).map((rec) => ({
      id: rec.id,
      outcomeScore: rec.outcomeScore,
      toolsUsed: rec.toolsUsed,
      lesson: rec.lesson,
      difficulty: rec.difficulty,
      taskPattern: rec.taskPattern,
      taskUnitId: rec.taskUnitId,
      goalId: rec.goalId,
      generation: rec.generation,
      merged: rec.merged,
      confidence: rec.confidence,
      reuseCount: rec.reuseCount,
      createdAt: rec.createdAt,
      actions: rec.actions,
    }))
  }

  /**
   * P5: Import experiences from a JSON array.
   * - Deduplicates by id (skip existing)
   * - Imported experiences go to young gen (generation=0)
   * - Returns { imported, skipped, invalid }
   */
  importExperiences(data: unknown[]): {
    imported: number
    skipped: number
    invalid: number
  } {
    let imported = 0
    let skipped = 0
    let invalid = 0

    const existingIds = new Set(
      (this.db.prepare('SELECT id FROM experiences').all() as { id: string }[]).map((r) => r.id),
    )

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO experiences (
        id, session_id, turn_id, created_at,
        context_hash, task_pattern, tools_used, workspace_digest,
        actions, outcome_score, user_feedback, lesson,
        difficulty, generation, last_injected_at, merged,
        tags, confidence, reuse_count
      ) VALUES (
        @id, @sessionId, @turnId, @createdAt,
        @contextHash, @taskPattern, @toolsUsed, @workspaceDigest,
        @actions, @outcomeScore, @userFeedback, @lesson,
        @difficulty, @generation, @lastInjectedAt, @merged,
        @tags, @confidence, @reuseCount
      )
    `)

    for (const item of data) {
      if (!isValidImportedExperience(item)) {
        invalid++
        continue
      }

      if (existingIds.has(item.id)) {
        skipped++
        continue
      }

      const contextHash = this.computeContextHash(
        item.taskPattern,
        item.toolsUsed,
        null,
      )

      insertStmt.run({
        id: item.id,
        sessionId: 'import',
        turnId: `import-${item.createdAt}`,
        createdAt: item.createdAt,
        contextHash,
        taskPattern: item.taskPattern,
        toolsUsed: item.toolsUsed ? JSON.stringify(item.toolsUsed) : null,
        workspaceDigest: null,
        actions: item.actions,
        outcomeScore: item.outcomeScore,
        userFeedback: 'none',
        lesson: item.lesson,
        difficulty: item.difficulty,
        generation: 0, // Imported experiences go to young gen
        lastInjectedAt: null,
        merged: item.merged ? 1 : 0,
        tags: null,
        confidence: item.confidence,
        reuseCount: item.reuseCount,
      })

      existingIds.add(item.id)
      imported++
    }

    // Enforce retention after import
    this.enforceRetention()

    return { imported, skipped, invalid }
  }

  // -------------------------------------------------------------------------
  // A3: Atomic facts — structured facts that never expire
  // ---------------------------------------------------------------------------

  /**
   * A3: Store or update an atomic fact.
   * If a fact with the same subject + predicate exists, update its object and bump confidence.
   * If not, create a new fact.
   */
  upsertFact(subject: string, predicate: string, object: string, source: string = 'model-inferred'): string {
    const id = ulid()
    const now = Date.now()

    // Check for existing fact with same subject + predicate
    const existing = this.db.prepare(`
      SELECT id, confidence FROM atomic_facts
      WHERE subject = @subject AND predicate = @predicate AND evicted = 0
    `).get({ subject, predicate }) as { id: string; confidence: number } | undefined

    if (existing) {
      // Update: newer fact overrides older, confidence boosted
      this.db.prepare(`
        UPDATE atomic_facts
        SET object = @object, source = @source, updated_at = @now,
            confidence = MIN(1.0, confidence + 0.1)
        WHERE id = @id
      `).run({ object, source, now, id: existing.id })
      return existing.id
    }

    this.db.prepare(`
      INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
      VALUES (@id, @subject, @predicate, @object, @source, @confidence, @createdAt)
    `).run({ id, subject, predicate, object, source, confidence: 0.5, createdAt: now })

    return id
  }

  /**
   * A3: Query atomic facts by subject (exact match) or full-text search.
   */
  queryFacts(subject?: string, searchText?: string): AtomicFact[] {
    if (subject) {
      const rows = this.db.prepare(`
        SELECT * FROM atomic_facts WHERE subject = @subject AND evicted = 0
        ORDER BY updated_at DESC, created_at DESC
      `).all({ subject }) as RawFactRow[]
      return rows.map((r) => this.rowToFact(r))
    }

    if (searchText) {
      try {
        const safeQuery = searchText
          .split(/[\s,]+/)
          .filter((t) => t.length > 0)
          .map((t) => `"${t.replace(/"/g, '""')}"`)
          .join(' ')
        if (safeQuery) {
          const rows = this.db.prepare(`
            SELECT f.* FROM atomic_facts f
            JOIN atomic_facts_fts ffts ON f.rowid = ffts.rowid
            WHERE atomic_facts_fts MATCH @matchText AND f.evicted = 0
            ORDER BY bm25(atomic_facts_fts) ASC
            LIMIT 20
          `).all({ matchText: safeQuery }) as RawFactRow[]
          return rows.map((r) => this.rowToFact(r))
        }
      } catch { /* fall through */ }
    }

    // No filter — return all non-evicted facts
    const rows = this.db.prepare(`
      SELECT * FROM atomic_facts WHERE evicted = 0
      ORDER BY updated_at DESC, created_at DESC LIMIT 100
    `).all() as RawFactRow[]
    return rows.map((r) => this.rowToFact(r))
  }

  /**
   * B2: Mark a fact as evicted (soft delete) — e.g. project migrated from Webpack to Vite.
   */
  evictFact(id: string): boolean {
    const result = this.db.prepare('UPDATE atomic_facts SET evicted = 1 WHERE id = ?').run(id)
    return result.changes > 0
  }

  /**
   * B2: Detect conflicts — same subject + predicate but different object.
   * Returns groups of conflicting facts.
   */
  detectFactConflicts(): { subject: string; predicate: string; conflicts: AtomicFact[] }[] {
    const rows = this.db.prepare(`
      SELECT subject, predicate, COUNT(*) as cnt
      FROM atomic_facts WHERE evicted = 0
      GROUP BY subject, predicate
      HAVING COUNT(DISTINCT object) > 1
    `).all() as { subject: string; predicate: string; cnt: number }[]

    return rows.map(({ subject, predicate }) => {
      const conflictRows = this.db.prepare(`
        SELECT * FROM atomic_facts
        WHERE subject = ? AND predicate = ? AND evicted = 0
        ORDER BY confidence DESC, updated_at DESC
      `).all(subject, predicate) as RawFactRow[]
      const conflicts = conflictRows.map((r) => this.rowToFact(r))
      // B1: Sort by source weight (higher = more authoritative), then confidence
      conflicts.sort((a, b) => {
        const w = (SOURCE_WEIGHTS[b.source] ?? 0) - (SOURCE_WEIGHTS[a.source] ?? 0)
        if (w !== 0) return w
        return b.confidence - a.confidence
      })
      return { subject, predicate, conflicts }
    })
  }

  private rowToFact(row: RawFactRow): AtomicFact {
    return {
      id: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      source: row.source,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? null,
      evicted: Boolean(row.evicted),
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
    this.db.exec('DELETE FROM atomic_facts')
  }
}

interface RawExperienceRow {
  id: string
  session_id: string
  turn_id: string
  created_at: number
  task_unit_id: string
  goal_id: string | null
  context_hash: string
  content_hash: string | null
  task_pattern: string | null
  tools_used: string | null
  workspace_digest: string | null
  actions: string
  outcome_score: number
  user_feedback: string
  lesson: string | null
  difficulty: string
  generation: number
  last_injected_at: number | null
  merged: number
  tags: string | null
  confidence: number
  reuse_count: number
  source: string
}

// B1: Source weight ranking — higher = more authoritative
const SOURCE_WEIGHTS: Record<string, number> = {
  'user-confirmed': 4,
  'tool-derived': 3,
  'model-inferred': 2,
  'chat-mention': 1,
}

// A3: Atomic fact types

export interface AtomicFact {
  id: string
  subject: string     // e.g. "project:my-app"
  predicate: string   // e.g. "deploy-command"
  object: string      // e.g. "pnpm run deploy"
  source: string      // B1: 'user-confirmed' | 'tool-derived' | 'model-inferred' | 'chat-mention'
  confidence: number
  createdAt: number
  updatedAt: number | null
  evicted: boolean
}

interface RawFactRow {
  id: string
  subject: string
  predicate: string
  object: string
  source: string
  confidence: number
  created_at: number
  updated_at: number | null
  evicted: number
}
