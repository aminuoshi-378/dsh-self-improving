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
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import type {
  ExperienceRecord,
  ExperienceQuery,
  TurnOutcome,
  Reflection,
  ExportedExperience,
  CorrectionEvent,
  CorrectionType,
  CorrectionSeverity,
} from '../types/index.js'
import { isValidImportedExperience } from '../types/index.js'
import {
  SMALL_STORE_THRESHOLD,
  MEDIUM_STORE_THRESHOLD,
  HIGH_QUALITY_THRESHOLD,
  CONFIDENCE_DECAY_FACTOR,
  MIN_CONFIDENCE,
  CONFIDENCE_BOOST,
  MAX_CONFIDENCE,
  FACT_INITIAL_CONFIDENCE,
  FACT_CONFIDENCE_BOOST,
  PROMOTE_REUSE_THRESHOLD,
  PROMOTE_SCORE_THRESHOLD,
  LOW_SCORE_GC_THRESHOLD,
  MERGED_OUTCOME_SCORE,
  TRANSFER_CONFIDENCE_INITIAL,
  TRANSFER_CONFIDENCE_MIN,
  TRANSFER_CONFIDENCE_MAX,
  TRANSFER_REWARD_PASS_USED,
  TRANSFER_PENALTY_FAIL_USED,
  TRANSFER_DECAY_FACTOR,
  MEMORY_TIER_EVENT,
  MEMORY_TIER_STRATEGY,
  STRATEGY_PROMOTE_TRANSFER_THRESHOLD,
  STRATEGY_DEMOTE_TRANSFER_THRESHOLD,
  STRATEGY_FORGET_TRANSFER_THRESHOLD,
} from '../types/constants.js'

export interface StoreOptions {
  /** Maximum records in young generation before minor GC. */
  youngGenMax?: number
  /** Maximum records in old generation before major GC. */
  oldGenMax?: number
  /** Number of unmerged lessons that triggers lesson merging. */
  lessonMergeThreshold?: number
  /** Days after which an unaccessed old-gen experience is downgraded. */
  experienceTtlDays?: number
  /** Score below which a low-confidence low-difficulty record may be forgotten. */
  forgetScoreThreshold?: number
  /** Confidence below which a low-score low-difficulty record may be forgotten. */
  forgetConfidenceThreshold?: number
}

const DEFAULT_STORE_OPTIONS: Required<StoreOptions> = {
  youngGenMax: 200,
  oldGenMax: 800,
  lessonMergeThreshold: 20,
  experienceTtlDays: 30,
  forgetScoreThreshold: 0.3,
  forgetConfidenceThreshold: 0.2,
}

export class ExperienceStore {
  private db: DatabaseType
  private storeCountSinceGC = 0
  private options: Required<StoreOptions>

  constructor(dbPath: string = ':memory:', options: StoreOptions = {}) {
    this.options = { ...DEFAULT_STORE_OPTIONS, ...options }

    const homeDir = process.env.HOME || homedir()
    const resolvedPath = dbPath.startsWith('~/')
      ? dbPath.replace('~/', `${homeDir}/`)
      : dbPath
    if (resolvedPath !== ':memory:') {
      const dir = resolvedPath.replace(/\/[^/]+$/, '')
      try { mkdirSync(dir, { recursive: true }) } catch {}
    }
    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.initSchema()
  }

  /** Current store options (read-only). */
  getOptions(): Readonly<Required<StoreOptions>> {
    return { ...this.options }
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
        source TEXT DEFAULT 'model-inferred',

        outcome_verdict TEXT,
        outcome_confidence REAL,
        acceptance_criteria TEXT,
        transfer_confidence REAL DEFAULT 0.5,
        semantic_key TEXT,
        memory_tier TEXT DEFAULT 'event'
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
    this.ensureColumn('outcome_verdict', 'TEXT')
    this.ensureColumn('outcome_confidence', 'REAL')
    this.ensureColumn('acceptance_criteria', 'TEXT')
    this.ensureColumn('transfer_confidence', 'REAL DEFAULT 0.5')
    this.ensureColumn('semantic_key', 'TEXT')
    this.ensureColumn('memory_tier', "TEXT DEFAULT 'event'")

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
      CREATE INDEX IF NOT EXISTS idx_experiences_semantic_key ON experiences(semantic_key);
      CREATE INDEX IF NOT EXISTS idx_experiences_memory_tier ON experiences(memory_tier);
    `)

    // A3/K3: FTS5 full-text index with trigram tokenizer for CJK support
    // trigram requires 3+ chars per match — suitable for lesson/actions text
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(
        lesson, actions, content='experiences', content_rowid='rowid',
        tokenize='trigram'
      );
    `)
    // K3: Migration — if old experiences_fts exists without trigram, rebuild
    try {
      this.db.exec(`INSERT INTO experiences_fts(experiences_fts) VALUES('rebuild')`)
    } catch { /* table empty or already in sync */ }
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
    // FTS5 for atomic facts (K3: trigram for CJK)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS atomic_facts_fts USING fts5(
        subject, object, content='atomic_facts', content_rowid='rowid',
        tokenize='trigram'
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

    // Correction events — 重构计划：以「用户纠正」为黄金信号。
    // 独立表保存结构化的纠正事件（节点定位），供检测/评分/提炼/注入四层共用，
    // 并通过 target_seq_hash 反查对应经验（用于「打压」而非仅学习）。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS correction_event (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,               -- 'correction' | 'revert' | 'redo' | 'interrupt'
        seq INTEGER NOT NULL DEFAULT 0,
        target_tool TEXT,
        target_seq_hash TEXT,
        user_text TEXT,
        intent TEXT,
        severity TEXT NOT NULL DEFAULT 'medium',  -- high | medium | low
        workspace_digest TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_correction_turn ON correction_event(turn_id);
      CREATE INDEX IF NOT EXISTS idx_correction_type ON correction_event(type);
      CREATE INDEX IF NOT EXISTS idx_correction_seq_hash ON correction_event(target_seq_hash);
      CREATE INDEX IF NOT EXISTS idx_correction_ws ON correction_event(workspace_digest);
    `)
    this.ensureColumnOn('correction_event', 'intent', 'TEXT')
    this.ensureColumnOn('correction_event', 'workspace_digest', 'TEXT')

    // v2 Truth-ground: task-unit aggregate entity. A TaskUnit is the granularity
    // at which a task's true outcome is judged (pass/fail/unknown), in contrast to
    // v1's per-turn scoring. turns (experiences rows) reference task_unit_id and
    // are backfilled with the verdict when the unit closes.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_unit (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        workspace_digest TEXT,
        acceptance_criteria TEXT,
        verdict TEXT,
        verdict_source TEXT,
        outcome_confidence REAL,
        started_at INTEGER,
        closed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_task_unit_goal ON task_unit(goal_id);
      CREATE INDEX IF NOT EXISTS idx_task_unit_ws ON task_unit(workspace_digest);
    `)

    // v2 Stage D: attribution_event — raw (injected, used, passed) triples for
    // the arm-based paired comparison (design-v2 §5.2). This is the "event layer"
    // evidence that drives transferConfidence via effect size, distinct from the
    // immediate bidirectional attribution of stage B.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attribution_event (
        id TEXT PRIMARY KEY,
        task_unit_id TEXT NOT NULL,
        experience_id TEXT NOT NULL,
        semantic_key TEXT,
        used INTEGER NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attribution_exp ON attribution_event(experience_id);
      CREATE INDEX IF NOT EXISTS idx_attribution_sem ON attribution_event(semantic_key);
      CREATE INDEX IF NOT EXISTS idx_attribution_tu ON attribution_event(task_unit_id);
    `)
  }

  /** Add a column to the experiences table if it doesn't already exist (migration support). */
  private ensureColumn(columnName: string, definition: string): void {
    const cols = this.db.prepare('PRAGMA table_info(experiences)').all() as { name: string }[]
    if (!cols.some((c) => c.name === columnName)) {
      this.db.exec(`ALTER TABLE experiences ADD COLUMN ${columnName} ${definition}`)
    }
  }

  /** Add a column to an arbitrary table if it doesn't already exist (migration support). */
  private ensureColumnOn(tableName: string, columnName: string, definition: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
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
    source?: string
    tags?: string[]
    semanticKey?: string | null
  }): string {
    const id = ulid()
    const taskUnitId = context.taskUnitId ?? id
    const source = context.source ?? 'model-inferred'
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
        tags, confidence, reuse_count, content_hash, source, transfer_confidence, semantic_key, memory_tier
      ) VALUES (
        @id, @sessionId, @turnId, @createdAt,
        @taskUnitId, @goalId,
        @contextHash, @taskPattern, @toolsUsed, @workspaceDigest,
        @actions, @outcomeScore, @userFeedback, @lesson,
        @difficulty, @generation, @lastInjectedAt, @merged,
        @tags, @confidence, @reuseCount, @contentHash, @source, @transferConfidence, @semanticKey, @memoryTier
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
      source,
      transferConfidence: TRANSFER_CONFIDENCE_INITIAL,
      semanticKey: context.semanticKey ?? null,
      memoryTier: MEMORY_TIER_EVENT,
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

  /** v2 (stage C): persist the semantic signature for an experience. */
  updateSemanticKey(id: string, semanticKey: string): void {
    this.db.prepare('UPDATE experiences SET semantic_key = ? WHERE id = ?').run(semanticKey, id)
  }

  /**
   * Increment reuse count and apply gradual confidence decay.
   * Called by the Behavior Adapter (Layer 2) when an experience is injected.
   * N2: Use relative decay (multiply) instead of absolute reset, so that
   * boostConfidence's accumulated +0.2 increments are not wiped out.
   */
  incrementReuse(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET reuse_count = reuse_count + 1,
          confidence = MAX(@minConfidence, confidence * @decayFactor),
          last_injected_at = @now
      WHERE id = @id
    `)

    stmt.run({ id, minConfidence: MIN_CONFIDENCE, decayFactor: CONFIDENCE_DECAY_FACTOR, now: Date.now() })
  }

  /**
   * Re-validate an experience by boosting its confidence.
   * Called when a new positive outcome confirms a past lesson.
   */
  boostConfidence(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET confidence = MIN(@maxConfidence, confidence + @boost)
      WHERE id = @id
    `)

    stmt.run({ id, maxConfidence: MAX_CONFIDENCE, boost: CONFIDENCE_BOOST })
  }

  /**
   * v2 (stage B): Bidirectional attribution on transferConfidence.
   *
   * Replaces v1's one-way `boostConfidence` optimistic bias (which rewarded an
   * injected experience whenever the turn scored high, regardless of causality).
   *
   * The core rule (§4.2): an injected experience's transferConfidence is only
   * moved when it was *actually used* (usedExperiences), never on mere injection:
   *   - pass + used → reward (the experience demonstrably helped).
   *   - fail + used → penalty (the experience demonstrably did not help).
   *   - not used     → no change (injection outcome is not attributable to it).
   *
   * This is the minimal causal ledger unit: (injected, used, verdict) triple.
   */
  applyAttribution(entries: {
    experienceId: string
    used: boolean
    passed: boolean
  }[]): void {
    if (!entries || entries.length === 0) return
    const txn = this.db.transaction(() => {
      const reward = this.db.prepare(`
        UPDATE experiences
        SET transfer_confidence = MIN(@max, transfer_confidence + @reward)
        WHERE id = @id
      `)
      const penalize = this.db.prepare(`
        UPDATE experiences
        SET transfer_confidence = MAX(@min, transfer_confidence - @penalty)
        WHERE id = @id
      `)
      for (const e of entries) {
        if (!e.used) continue
        if (e.passed) {
          reward.run({ id: e.experienceId, max: TRANSFER_CONFIDENCE_MAX, reward: TRANSFER_REWARD_PASS_USED })
        } else {
          penalize.run({ id: e.experienceId, min: TRANSFER_CONFIDENCE_MIN, penalty: TRANSFER_PENALTY_FAIL_USED })
        }
      }
    })
    txn()
  }

  /** v2 (stage B): Apply time decay to transferConfidence for records not revalidated. */
  decayTransferConfidence(ids: string[]): void {
    if (!ids || ids.length === 0) return
    const stmt = this.db.prepare(`
      UPDATE experiences
      SET transfer_confidence = transfer_confidence * @factor
      WHERE id IN (${ids.map(() => '?').join(',')})
    `)
    stmt.run(...ids.map((id) => id), { factor: TRANSFER_DECAY_FACTOR })
  }

  // -------------------------------------------------------------------------
  // v2 stage D: arm-based paired comparison (attribution_event)
  // -------------------------------------------------------------------------

  /**
   * Record one (injected, used, passed) attribution triple for a closed task unit.
   * This is the raw "event layer" evidence for the arm-based comparison (§5.2).
   */
  recordAttributionEvent(input: {
    taskUnitId: string
    experienceId: string
    semanticKey: string | null
    used: boolean
    passed: boolean
  }): void {
    this.db.prepare(`
      INSERT INTO attribution_event (
        id, task_unit_id, experience_id, semantic_key, used, passed, created_at
      ) VALUES (
        @id, @taskUnitId, @experienceId, @semanticKey, @used, @passed, @createdAt
      )
    `).run({
      id: ulid(),
      taskUnitId: input.taskUnitId,
      experienceId: input.experienceId,
      semanticKey: input.semanticKey,
      used: input.used ? 1 : 0,
      passed: input.passed ? 1 : 0,
      createdAt: Date.now(),
    })
  }

  /**
   * Aggregate raw attribution triples into arm counts for one experience within
   * a comparable semantic cluster. The baseline arm is the subset of tasks in the
   * same semantic_key where the experience was NOT used; the injected arm is
   * where it WAS used.
   */
  queryAttributionArms(experienceId: string, semanticKey: string | null): {
    injectedTotal: number
    injectedPass: number
    baselineTotal: number
    baselinePass: number
  } {
    // Injected arm: tasks where this experience was used.
    const injected = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(passed) AS passed
      FROM attribution_event WHERE experience_id = ? AND used = 1
    `).get(experienceId) as { total: number; passed: number | null }
    // Baseline arm: tasks in the same semantic cluster where this experience was NOT used.
    let baseline: { total: number; passed: number | null }
    if (semanticKey) {
      baseline = this.db.prepare(`
        SELECT COUNT(*) AS total, SUM(passed) AS passed
        FROM attribution_event WHERE semantic_key = ? AND experience_id != ? AND used = 0
      `).get(semanticKey, experienceId) as { total: number; passed: number | null }
    } else {
      baseline = { total: 0, passed: null }
    }
    return {
      injectedTotal: injected.total,
      injectedPass: injected.passed ?? 0,
      baselineTotal: baseline.total,
      baselinePass: baseline.passed ?? 0,
    }
  }

  /**
   * Apply a transferConfidence delta (positive reward / negative penalty) to an
   * experience, clamped to [MIN, MAX]. Used by the effect-size calibration.
   */
  applyEffectSizeDelta(experienceId: string, delta: number): void {
    if (delta === 0) return
    if (delta > 0) {
      this.db.prepare(
        'UPDATE experiences SET transfer_confidence = MIN(@max, transfer_confidence + @delta) WHERE id = @id',
      ).run({ id: experienceId, max: TRANSFER_CONFIDENCE_MAX, delta })
    } else {
      this.db.prepare(
        'UPDATE experiences SET transfer_confidence = MAX(@min, transfer_confidence + @delta) WHERE id = @id',
      ).run({ id: experienceId, min: TRANSFER_CONFIDENCE_MIN, delta })
    }
  }

  /**
   * Return distinct (experience_id, semantic_key) pairs that have accumulated
   * attribution events, for periodic effect-size calibration.
   */
  listAttributedExperiences(): { experienceId: string; semanticKey: string | null }[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT experience_id, semantic_key FROM attribution_event
    `).all() as { experience_id: string; semantic_key: string | null }[]
    return rows.map((r) => ({ experienceId: r.experience_id, semanticKey: r.semantic_key }))
  }

  // -------------------------------------------------------------------------
  // v2 stage E: layered memory (event → strategy tier)
  // -------------------------------------------------------------------------

  /**
   * Promote event-tier experiences with a lesson and high transferConfidence to
   * the strategy tier. A strategy-tier experience is a *transferable practice*
   * (design-v2 §6), not just a raw single-task record.
   */
  promoteToStrategy(): number {
    const result = this.db.prepare(`
      UPDATE experiences
      SET memory_tier = @strategy
      WHERE memory_tier = @event
        AND lesson IS NOT NULL
        AND merged = 0
        AND transfer_confidence >= @threshold
    `).run({
      strategy: MEMORY_TIER_STRATEGY,
      event: MEMORY_TIER_EVENT,
      threshold: STRATEGY_PROMOTE_TRANSFER_THRESHOLD,
    })
    return result.changes
  }

  /**
   * Demote strategy-tier experiences whose transferConfidence has dropped below
   * the demote threshold back to the event tier (they have not proven
   * transferable). Does NOT delete — they re-enter the event layer.
   */
  demoteFromStrategy(): number {
    const result = this.db.prepare(`
      UPDATE experiences
      SET memory_tier = @event
      WHERE memory_tier = @strategy
        AND transfer_confidence < @threshold
    `).run({
      event: MEMORY_TIER_EVENT,
      strategy: MEMORY_TIER_STRATEGY,
      threshold: STRATEGY_DEMOTE_TRANSFER_THRESHOLD,
    })
    return result.changes
  }

  /**
   * Forget strategy-tier experiences whose transferConfidence has fallen below
   * the forget threshold. This is the only point where strategy knowledge is
   * deleted — driven by transferConfidence (not raw capacity), per §6.
   */
  forgetStrategy(): number {
    const result = this.db.prepare(`
      DELETE FROM experiences
      WHERE memory_tier = @strategy
        AND transfer_confidence < @threshold
    `).run({
      strategy: MEMORY_TIER_STRATEGY,
      threshold: STRATEGY_FORGET_TRANSFER_THRESHOLD,
    })
    return result.changes
  }

  // -------------------------------------------------------------------------
  // Correction events (重构计划：以「用户纠正」为黄金信号)
  // -------------------------------------------------------------------------

  /** Insert correction events detected for a turn (idempotent by event id). */
  storeCorrectionEvents(
    sessionId: string,
    turnId: string,
    events: CorrectionEvent[],
    workspaceDigest?: string | null,
  ): void {
    if (!events || events.length === 0) return
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO correction_event (
        id, turn_id, session_id, type, seq, target_tool, target_seq_hash,
        user_text, intent, severity, workspace_digest, created_at
      ) VALUES (
        @id, @turnId, @sessionId, @type, @seq, @targetTool, @targetSeqHash,
        @userText, @intent, @severity, @workspaceDigest, @createdAt
      )
    `)
    const tx = this.db.transaction((rows: CorrectionEvent[]) => {
      for (const e of rows) {
        stmt.run({
          id: e.id,
          turnId: e.turnId ?? turnId,
          sessionId: e.sessionId ?? sessionId,
          type: e.type,
          seq: e.seq,
          targetTool: e.targetTool,
          targetSeqHash: e.targetSeqHash,
          userText: e.userText,
          intent: e.intent,
          severity: e.severity,
          workspaceDigest: workspaceDigest ?? null,
          createdAt: e.createdAt,
        })
      }
    })
    tx(events)
  }

  /** Read correction events for a turn (lesson / refinement context). */
  queryCorrectionEventsByTurn(turnId: string): CorrectionEvent[] {
    const rows = this.db.prepare(
      `SELECT ${CORRECTION_EVENT_COLUMNS} FROM correction_event WHERE turn_id = ? ORDER BY seq ASC`,
    ).all(turnId) as RawCorrectionEventRow[]
    return rows.map(rowToCorrectionEvent)
  }

  /** Read the most recent correction events, optionally scoped to a workspace. */
  queryCorrectionEvents(limit: number = 10, workspaceDigest?: string | null): CorrectionEvent[] {
    const rows = workspaceDigest
      ? this.db.prepare(
          `SELECT ${CORRECTION_EVENT_COLUMNS} FROM correction_event WHERE workspace_digest = ? ORDER BY created_at DESC LIMIT ?`,
        ).all(workspaceDigest, limit) as RawCorrectionEventRow[]
      : this.db.prepare(
          `SELECT ${CORRECTION_EVENT_COLUMNS} FROM correction_event ORDER BY created_at DESC LIMIT ?`,
        ).all(limit) as RawCorrectionEventRow[]
    return rows.map(rowToCorrectionEvent)
  }

  /**
   * Δ7-2 redo 对比对：按工具序列内容指纹反查此前被「重做」的经验。
   * 用于把用户明确想重做的那条经验列出来（对比、打压倾向）。
   */
  queryExperiencesByContentHash(seqHash: string, limit: number = 5): ExperienceRecord[] {
    const rows = this.db.prepare(
      `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE content_hash = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(seqHash, limit) as RawExperienceRow[]
    return rows.map((r) => this.rowToRecord(r))
  }

  /**
   * v2 (stage C): Semantic retrieval by semantic signature.
   *
   * Replaces v1's tool-sequence-as-primary-key retrieval with semantic-signature
   * matching. A task's `semantic_key` (LLM-reduced label, e.g. "add-npm-test-script")
   * captures *what* the task is about, so two tasks using the same tools but
   * solving different problems no longer collide (the D4 defect).
   *
   * Match order:
   *   1. exact semantic_key match (highest relevance)
   *   2. shared semantic token prefix (partial overlap, e.g. "add-npm-" prefix)
   *   3. fallback to taskPattern match when no semantic_key exists
   * Results are ordered by semantic similarity then transferConfidence desc.
   */
  queryBySemanticKey(semanticKey: string | null, opts?: {
    limit?: number
    minScore?: number
    workspaceDigest?: string | null
    taskPattern?: string | null
  }): ExperienceRecord[] {
    const limit = opts?.limit ?? 10
    const minScore = opts?.minScore ?? 0.0

    if (!semanticKey) {
      // No semantic signature — fall back to taskPattern (v1 behavior).
      if (!opts?.taskPattern) return []
      const rows = this.db.prepare(
        `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE task_pattern = ? AND outcome_score >= ? AND merged = 0 ORDER BY outcome_score DESC, created_at DESC LIMIT ?`,
      ).all(opts.taskPattern, minScore, limit) as RawExperienceRow[]
      return rows.map((r) => this.rowToRecord(r))
    }

    // Tokenize the semantic key for prefix/overlap matching.
    const tokens = semanticKey.toLowerCase().split(/[-_\s]+/).filter((t) => t.length > 0)
    const exactRows = this.db.prepare(
      `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE semantic_key = ? AND outcome_score >= ? AND merged = 0 LIMIT ?`,
    ).all(semanticKey, minScore, limit * 2) as RawExperienceRow[]

    // Prefix/overlap matches: any row whose semantic_key shares a leading token.
    let overlapRows: RawExperienceRow[] = []
    if (tokens.length > 0) {
      const all = this.db.prepare(
        `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE semantic_key IS NOT NULL AND outcome_score >= ? AND merged = 0 LIMIT 200`,
      ).all(minScore) as RawExperienceRow[]
      overlapRows = all.filter((r) => {
        const rk = (r.semantic_key ?? '').toLowerCase()
        return rk !== semanticKey.toLowerCase() && tokens.some((t) => rk.startsWith(t))
      })
    }

    const records = [...exactRows, ...overlapRows]
      .map((r) => this.rowToRecord(r))
      // Deduplicate by id (exact + overlap may overlap).
      .filter((rec, i, arr) => arr.findIndex((x) => x.id === rec.id) === i)
      // Semantic similarity: exact match = 1.0, prefix match = partial token overlap.
      .map((rec) => ({ rec, sim: this.semanticSimilarity(semanticKey, rec.semanticKey) }))
      .sort((a, b) => {
        if (b.sim !== a.sim) return b.sim - a.sim
        return (b.rec.transferConfidence ?? 0) - (a.rec.transferConfidence ?? 0)
      })
      .slice(0, limit)
      .map((item) => item.rec)

    return records
  }

  /** Token-overlap similarity between two semantic keys (0.0–1.0). */
  private semanticSimilarity(a: string, b: string | null): number {
    if (!b) return 0
    if (a === b) return 1.0
    const ta = new Set(a.toLowerCase().split(/[-_\s]+/).filter(Boolean))
    const tb = new Set(b.toLowerCase().split(/[-_\s]+/).filter(Boolean))
    if (ta.size === 0 || tb.size === 0) return 0
    let overlap = 0
    for (const t of ta) if (tb.has(t)) overlap++
    return overlap / Math.max(ta.size, tb.size)
  }

  /**
   * Δ7-2 redo 对比对：对与目标序列指纹相同的既有经验做轻度「打压」（降置信度），
   * 使被用户纠正/重做过的做法更不容易被再次注入。返回受影响条数。
   */
  penalizeByContentHash(seqHash: string, delta: number = 0.05): number {
    if (!seqHash) return 0
    const result = this.db.prepare(
      'UPDATE experiences SET confidence = MAX(?, confidence - ?) WHERE content_hash = ? AND merged = 0',
    ).run(MIN_CONFIDENCE, delta, seqHash)
    return result.changes
  }

  /** Δ7.1: persist LLM/rule-based extracted intent for a correction event. */
  updateCorrectionIntent(eventId: string, intent: string): void {
    this.db.prepare('UPDATE correction_event SET intent = ? WHERE id = ?').run(intent, eventId)
  }

  // -------------------------------------------------------------------------
  // Task unit (v2 truth-ground) — aggregate entity for task-level verdicts
  // -------------------------------------------------------------------------

  /** Create a task-unit row (idempotent by id). */
  createTaskUnit(input: {
    taskUnitId: string
    goalId: string | null
    workspaceDigest: string | null
    acceptanceCriteria: string | null
    startedAt: number
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO task_unit (
        id, goal_id, workspace_digest, acceptance_criteria, started_at
      ) VALUES (
        @id, @goalId, @workspaceDigest, @acceptanceCriteria, @startedAt
      )
    `).run({
      id: input.taskUnitId,
      goalId: input.goalId,
      workspaceDigest: input.workspaceDigest,
      acceptanceCriteria: input.acceptanceCriteria,
      startedAt: input.startedAt,
    })
  }

  /** Persist the resolved verdict for a task unit and backfill its turns. */
  closeTaskUnit(input: {
    taskUnitId: string
    verdict: string
    verdictSource: string
    outcomeConfidence: number
    closedAt: number
  }): void {
    const txn = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE task_unit
        SET verdict = @verdict,
            verdict_source = @verdictSource,
            outcome_confidence = @outcomeConfidence,
            closed_at = @closedAt
        WHERE id = @id
      `).run({
        id: input.taskUnitId,
        verdict: input.verdict,
        verdictSource: input.verdictSource,
        outcomeConfidence: input.outcomeConfidence,
        closedAt: input.closedAt,
      })
      // Backfill all turns belonging to this task unit with the resolved verdict.
      this.db.prepare(`
        UPDATE experiences
        SET outcome_verdict = @verdict, outcome_confidence = @outcomeConfidence
        WHERE task_unit_id = @id
      `).run({
        id: input.taskUnitId,
        verdict: input.verdict,
        outcomeConfidence: input.outcomeConfidence,
      })
    })
    txn()
  }

  /**
   * Persist a late-arriving explicit user feedback onto an experience.
   * Used by the L0 feedback backfill: no-goal task units close at turn-stopping
   * before the user rates the reply, so the rating is applied retroactively.
   */
  updateExperienceFeedback(expId: string, feedback: 'positive' | 'negative'): void {
    this.db.prepare('UPDATE experiences SET user_feedback = ? WHERE id = ?').run(feedback, expId)
  }

  /** Read a task-unit row by id (undefined when absent). */
  getTaskUnit(taskUnitId: string): RawTaskUnitRow | undefined {
    return this.db.prepare(`SELECT ${TASK_UNIT_COLUMNS} FROM task_unit WHERE id = ?`).get(taskUnitId) as RawTaskUnitRow | undefined
  }

  /** Persist the acceptance criteria for a task unit (generated at task start). */
  updateTaskUnitAcceptanceCriteria(taskUnitId: string, acceptanceCriteria: string): void {
    this.db.prepare('UPDATE task_unit SET acceptance_criteria = ? WHERE id = ?').run(acceptanceCriteria, taskUnitId)
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

    // Dynamic candidate set sizing (P4) + A6: quality-aware scaling
    const totalCount = this.count()
    const avgScore = this.stats().avgScore
    let coarseLimit: number
    if (totalCount < SMALL_STORE_THRESHOLD) {
      // Small store: return everything for best signal
      coarseLimit = Math.max(limit * 5, SMALL_STORE_THRESHOLD)
    } else if (totalCount < MEDIUM_STORE_THRESHOLD) {
      // A6: When avg score is high, shrink candidate pool (fewer needed to find value)
      // When low, expand it (need more candidates to find something useful)
      coarseLimit = avgScore > HIGH_QUALITY_THRESHOLD ? 15 : 25
    } else {
      // A6: Same principle at larger scale
      coarseLimit = avgScore > HIGH_QUALITY_THRESHOLD ? 40 : 60
    }

    // Stage 1: Coarse filter
    let rows: RawExperienceRow[]

    if (query.searchText) {
      // A3/K3: FTS5 + BM25 search with trigram tokenizer
      // trigram requires 3+ chars per term, so filter short tokens
      try {
        const safeQuery = query.searchText
          .split(/[\s,]+/)
          .filter((t) => t.length >= 3)
          .map((t) => `"${t.replace(/"/g, '""')}"`)
          .join(' ')
        if (safeQuery) {
          // O4: Include taskPattern filter in FTS5 query
          let ftsSql = `
            SELECT ${EXPERIENCES_COLUMNS.split(', ').map(c => 'e.' + c).join(', ')} FROM experiences e
            JOIN experiences_fts f ON e.rowid = f.rowid
            WHERE experiences_fts MATCH @matchText
              AND e.outcome_score >= @minScore
              AND e.merged = 0`
          const ftsParams: Record<string, unknown> = { matchText: safeQuery, minScore, fetchLimit: coarseLimit }
          if (query.taskPattern) {
            ftsSql += ` AND (e.task_pattern = @taskPattern OR e.task_pattern IS NULL)`
            ftsParams.taskPattern = query.taskPattern
          }
          ftsSql += ` ORDER BY bm25(experiences_fts) ASC LIMIT @fetchLimit`
          rows = this.db.prepare(ftsSql).all(ftsParams) as RawExperienceRow[]
        } else {
          let sql = `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE outcome_score >= @minScore AND merged = 0`
          const params: Record<string, unknown> = { minScore, fetchLimit: coarseLimit }
          if (query.taskPattern) {
            sql += ` AND (task_pattern = @taskPattern OR task_pattern IS NULL)`
            params.taskPattern = query.taskPattern
          }
          sql += ` ORDER BY outcome_score DESC, created_at DESC LIMIT @fetchLimit`
          rows = this.db.prepare(sql).all(params) as RawExperienceRow[]
        }
      } catch {
        // FTS5 not available or query syntax error — fall back to SQL filter
        rows = this.db.prepare(`
          SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE outcome_score >= @minScore AND merged = 0
          ORDER BY outcome_score DESC, created_at DESC LIMIT @fetchLimit
        `).all({ minScore, fetchLimit: coarseLimit }) as RawExperienceRow[]
      }
    } else {
      // Standard coarse filter via SQL
      let sql = `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE outcome_score >= @minScore AND merged = 0`
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
      `SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE id = ?`,
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
        COALESCE(AVG(CASE WHEN merged = 0 THEN outcome_score END), 0) as avgScore,
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

  /**
   * Phase 6-1: Aggregate outcome statistics for a task pattern, WITHOUT the
   * E2 content-hash deduplication used for injection. Model selection needs the
   * full sample (every historical attempt) to estimate success rate, not the
   * deduplicated "best per tool sequence" projection.
   *
   * @param taskPattern - the task type to aggregate, or undefined for all.
   */
  taskPatternStats(taskPattern?: string): { count: number; avgScore: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(AVG(outcome_score), 0) as avgScore
      FROM experiences
      WHERE merged = 0
        AND (@taskPattern IS NULL OR task_pattern = @taskPattern OR task_pattern IS NULL)
    `).get({ taskPattern: taskPattern ?? null }) as { count: number; avgScore: number }

    return { count: row.count, avgScore: row.avgScore ?? 0 }
  }

  /**
   * Phase 6-2: Count how many distinct failed experiences used each tool name.
   *
   * Reads experiences with `outcome_score <= 0.3` (the "failed outcome" band),
   * parses their `tools_used` JSON, and counts each tool's occurrences across
   * distinct failed experiences. Used by `guardTool` to decide whether a tool
   * has failed often enough to warrant denying it.
   *
   * @param minFailures - return only tools that failed at least this many times.
   * @returns map of tool name → number of distinct failed experiences containing it.
   */
  failedToolCounts(minFailures: number = 1): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT tools_used FROM experiences
      WHERE merged = 0 AND outcome_score <= 0.3 AND tools_used IS NOT NULL
    `).all() as { tools_used: string }[]

    const counts = new Map<string, number>()
    for (const row of rows) {
      let tools: string[] = []
      try {
        const parsed = JSON.parse(row.tools_used)
        if (Array.isArray(parsed)) tools = parsed.filter((t): t is string => typeof t === 'string')
      } catch { /* malformed tools_used — skip */ }

      // Count each distinct tool once per failed experience
      for (const tool of new Set(tools)) {
        counts.set(tool, (counts.get(tool) ?? 0) + 1)
      }
    }

    // Drop tools below the failure threshold
    for (const [tool, count] of counts) {
      if (count < minFailures) counts.delete(tool)
    }

    return counts
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
   * Young Gen (generation=0): max options.youngGenMax records.
   *   - Minor GC when over capacity: evict low quality (low score, no lesson, low difficulty)
   *   - Survivors (reused or score>=0.8 or has lesson) promoted to old gen
   *
   * Old Gen (generation=1): max options.oldGenMax records.
   *   - Major GC when over capacity: evict by quality priority
   *     Priority: difficulty=low > no lesson > score<0.5 > merged=true
   *     Never evict: difficulty=high with lesson
   */
  private enforceRetention(): void {
    // R5: Wrap GC operations in a transaction for atomicity
    const txn = this.db.transaction(() => {
      // P1: activeForget runs every time (indexed, fast), TTL throttled (full-table UPDATE)
      this.activeForget()

      this.storeCountSinceGC++
      if (this.storeCountSinceGC >= 10) {
        this.storeCountSinceGC = 0
        this.applyTTL()
      }

      // --- Minor GC: young generation ---
      const youngCount = (this.db.prepare(
        'SELECT COUNT(*) as c FROM experiences WHERE generation = 0',
      ).get() as { c: number }).c

      if (youngCount > this.options.youngGenMax) {
        // Promote survivors first
        this.promoteYoungGen()

        // Then evict low quality from young gen
        const toEvict = youngCount - this.options.youngGenMax
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

      if (oldCount > this.options.oldGenMax) {
        const toEvict = oldCount - this.options.oldGenMax
        this.db.prepare(`
          DELETE FROM experiences
          WHERE id IN (
            SELECT id FROM experiences
            WHERE generation = 1
              AND NOT (difficulty = 'high' AND lesson IS NOT NULL)
            ORDER BY
              CASE WHEN difficulty = 'low' THEN 0 ELSE 1 END,
              CASE WHEN lesson IS NULL THEN 0 ELSE 1 END,
              CASE WHEN outcome_score < @lowScore THEN 0 ELSE 1 END,
              CASE WHEN merged = 1 THEN 0 ELSE 1 END,
              outcome_score ASC,
              created_at ASC
            LIMIT @toEvict
          )
        `).run({ toEvict, lowScore: LOW_SCORE_GC_THRESHOLD })

        // If still over, evict lowest score
        const remainingOld = (this.db.prepare(
          'SELECT COUNT(*) as c FROM experiences WHERE generation = 1',
        ).get() as { c: number }).c
        if (remainingOld > this.options.oldGenMax) {
          this.db.prepare(`
            DELETE FROM experiences
            WHERE id IN (
              SELECT id FROM experiences
              WHERE generation = 1
              ORDER BY outcome_score ASC
              LIMIT @extra
            )
          `).run({ extra: remainingOld - this.options.oldGenMax })
        }
      }
    })
    txn()
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
        AND (reuse_count >= @reuse
          OR (outcome_score >= @score AND lesson IS NOT NULL)
          OR merged = 1)
    `).run({ reuse: PROMOTE_REUSE_THRESHOLD, score: PROMOTE_SCORE_THRESHOLD })
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
    `).run({ scoreThreshold: this.options.forgetScoreThreshold, confidenceThreshold: this.options.forgetConfidenceThreshold })
    if (result.changes > 0) {
      // Could log here if needed
    }
  }

  /**
   * A2: TTL expiry — downgrade old-gen experiences not injected in experienceTtlDays to young gen.
   * This lets stale experiences re-enter the Minor GC cycle and potentially get evicted.
   * High-difficulty experiences with lessons are exempt (knowledge may still be valuable even if stale).
   */
  private applyTTL(): void {
    const cutoff = Date.now() - this.options.experienceTtlDays * 24 * 60 * 60 * 1000
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
      const rawTools = parsed.tools ?? []
      if (!Array.isArray(rawTools) || rawTools.length === 0) return null
      // O3: Normalize tool entries — handle both {name,success} and {tool,ok} formats
      // Q2: Filter out entries with no valid tool name (was broken by `|| true`)
      const tools = rawTools.map((t: any) => {
        const name = t?.name ?? t?.tool
        const success = t?.success ?? t?.ok
        return { name: typeof name === 'string' ? name : '', success: success !== false }
      }).filter((t: { name: string }) => t.name.length > 0)
      if (tools.length === 0) return null
      // Format: toolName:success,toolName:success,...|workspace
      const toolStr = tools.map((t: { name: string; success: boolean }) => `${t.name}:${t.success}`).join(',')
      const input = `${toolStr}|${workspaceDigest ?? ''}`
      return createHash('sha1').update(input).digest('hex').slice(0, 16)
    } catch {
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
    // O1: Safe JSON.parse with fallback for corrupted data
    let toolsUsed: string[] | null = null
    if (row.tools_used) {
      try { toolsUsed = JSON.parse(row.tools_used) } catch { toolsUsed = null }
    }
    let tags: string[] | null = null
    if (row.tags) {
      try { tags = JSON.parse(row.tags) } catch { tags = null }
    }

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
      toolsUsed,
      workspaceDigest: row.workspace_digest,
      actions: row.actions,
      outcomeScore: row.outcome_score,
      userFeedback: row.user_feedback,
      lesson: row.lesson,
      difficulty: (row.difficulty as 'low' | 'medium' | 'high') ?? 'medium',
      generation: row.generation ?? 0,
      lastInjectedAt: row.last_injected_at ?? null,
      merged: Boolean(row.merged),
      tags,
      confidence: row.confidence,
      reuseCount: row.reuse_count,
      source: row.source ?? 'model-inferred',
      transferConfidence: row.transfer_confidence ?? TRANSFER_CONFIDENCE_INITIAL,
      semanticKey: row.semantic_key ?? null,
      memoryTier: (row.memory_tier ?? MEMORY_TIER_EVENT) as 'event' | 'strategy',
    }
  }

  // -------------------------------------------------------------------------
  // P2: Lesson merging
  // -------------------------------------------------------------------------

  /**
   * Get unmerged lessons grouped by difficulty + tool similarity.
   * Returns groups suitable for LLM-based merging.
   */
  getUnmergedLessonGroups(threshold: number = this.options.lessonMergeThreshold): {
    difficulty: string
    toolsKey: string
    records: ExperienceRecord[]
  }[] {
    const unmergedCount = (this.db.prepare(
      `SELECT COUNT(*) as c FROM experiences WHERE lesson IS NOT NULL AND merged = 0`,
    ).get() as { c: number }).c

    if (unmergedCount < threshold) return []

    const rows = this.db.prepare(`
      SELECT ${EXPERIENCES_COLUMNS} FROM experiences
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

    // R4: Wrap INSERT + markMerged in a transaction for atomicity
    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO experiences (
          id, session_id, turn_id, created_at,
          context_hash, content_hash, task_pattern, tools_used, workspace_digest,
          actions, outcome_score, user_feedback, lesson,
          difficulty, generation, last_injected_at, merged,
          tags, confidence, reuse_count, source
        ) VALUES (
          @id, @sessionId, @turnId, @createdAt,
          @contextHash, @contentHash, @taskPattern, @toolsUsed, @workspaceDigest,
          @actions, @outcomeScore, @userFeedback, @lesson,
          @difficulty, @generation, @lastInjectedAt, @merged,
          @tags, @confidence, @reuseCount, @source
        )
      `).run({
        id,
        sessionId: 'merge',
        turnId: `merge-${Date.now()}`,
        createdAt: Date.now(),
        contextHash,
        contentHash: `merge-${contextHash}`,
        taskPattern: null,
        toolsUsed: JSON.stringify(toolsUsed),
        workspaceDigest: null,
        actions: JSON.stringify({ merged_from: sourceIds }),
        outcomeScore: MERGED_OUTCOME_SCORE,
        userFeedback: 'none',
        lesson: JSON.stringify(mergedLesson),
        difficulty,
        generation: 1,
        lastInjectedAt: null,
        merged: 0,
        tags: JSON.stringify(['merged']),
        confidence: 1.0,
        reuseCount: 0,
        source: 'merged',
      })

      // Mark source records as merged
      for (const sourceId of sourceIds) {
        this.markMerged(sourceId)
      }
    })
    txn()

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
      SELECT ${EXPERIENCES_COLUMNS} FROM experiences ORDER BY created_at ASC
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
      source: rec.source,
      contentHash: rec.contentHash,
    }))
  }

  /**
   * P5: Export filtered experiences by task pattern.
   */
  exportByTaskPattern(taskPattern: string): ExportedExperience[] {
    const rows = this.db.prepare(`
      SELECT ${EXPERIENCES_COLUMNS} FROM experiences WHERE task_pattern = ? ORDER BY created_at ASC
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
      source: rec.source,
      contentHash: rec.contentHash,
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
        context_hash, content_hash, task_pattern, tools_used, workspace_digest,
        actions, outcome_score, user_feedback, lesson,
        difficulty, generation, last_injected_at, merged,
        tags, confidence, reuse_count, source
      ) VALUES (
        @id, @sessionId, @turnId, @createdAt,
        @contextHash, @contentHash, @taskPattern, @toolsUsed, @workspaceDigest,
        @actions, @outcomeScore, @userFeedback, @lesson,
        @difficulty, @generation, @lastInjectedAt, @merged,
        @tags, @confidence, @reuseCount, @source
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
      // K1: Preserve source and content_hash from import data
      const contentHash = item.contentHash ?? this.computeContentHash(item.actions, null) ?? null

      insertStmt.run({
        id: item.id,
        sessionId: 'import',
        turnId: `import-${item.createdAt}`,
        createdAt: item.createdAt,
        contextHash,
        contentHash,
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
        source: item.source,
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
    // B2: Canonicalize subject/predicate so variants collapse to one fact
    const norm = normalizeFactKey(subject, predicate)
    const { subject: cSubject, predicate: cPredicate } = norm

    const id = ulid()
    const now = Date.now()

    // Check for existing fact with same subject + predicate
    const existing = this.db.prepare(`
      SELECT id, confidence FROM atomic_facts
      WHERE subject = @subject AND predicate = @predicate AND evicted = 0
    `).get({ subject: cSubject, predicate: cPredicate }) as { id: string; confidence: number } | undefined

    if (existing) {
      // Update: newer fact overrides older, confidence boosted
      this.db.prepare(`
        UPDATE atomic_facts
        SET object = @object, source = @source, updated_at = @now,
            confidence = MIN(@maxConfidence, confidence + @boost)
        WHERE id = @id
      `).run({ object, source, now, boost: FACT_CONFIDENCE_BOOST, maxConfidence: MAX_CONFIDENCE, id: existing.id })
      return existing.id
    }

    this.db.prepare(`
      INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
      VALUES (@id, @subject, @predicate, @object, @source, @confidence, @createdAt)
    `).run({ id, subject: cSubject, predicate: cPredicate, object, source, confidence: FACT_INITIAL_CONFIDENCE, createdAt: now })

    return id
  }

  /**
   * T4: Store a tool-sequence fact as a MULTI-VALUED fact.
   *
   * Unlike `upsertFact` (whose `(subject, predicate)` key is single-valued and
   * overwrites the object), a workspace has MANY distinct effective/failed tool
   * sequences. Writing them all to the same `(subject, 'failed-tool-sequence')`
   * key overwrites earlier sequences — the T4 bug.
   *
   * Here the sequence is hashed into the predicate suffix so each distinct
   * sequence is its own fact. The base predicate (e.g. `failed-tool-sequence`)
   * stays a recognizable prefix for `queryFacts` filtering via `startsWith`.
   *
   * @param subject - workspace subject (already normalized by caller).
   * @param basePredicate - 'effective-tool-sequence' | 'failed-tool-sequence'.
   * @param sequence - the tool sequence string (e.g. "write → bash").
   * @param source - fact source weight tag.
   */
  upsertToolSequenceFact(
    subject: string,
    basePredicate: 'effective-tool-sequence' | 'failed-tool-sequence',
    sequence: string,
    source: string = 'tool-derived',
  ): string {
    const seqHash = createHash('sha1').update(sequence).digest('hex').slice(0, 12)
    // Predicate encodes the sequence hash so each sequence is an independent fact.
    return this.upsertFact(subject, `${basePredicate}:${seqHash}`, sequence, source)
  }

  /**
   * A3: Query atomic facts by subject (exact match) or full-text search.
   */
  queryFacts(subject?: string, searchText?: string): AtomicFact[] {
    if (subject) {
      const rows = this.db.prepare(`
        SELECT ${ATOMIC_FACTS_COLUMNS} FROM atomic_facts WHERE subject = @subject AND evicted = 0
        ORDER BY updated_at DESC, created_at DESC
      `).all({ subject }) as RawFactRow[]
      return rows.map((r) => this.rowToFact(r))
    }

    if (searchText) {
      try {
        const safeQuery = searchText
          .split(/[\s,]+/)
          .filter((t) => t.length >= 3)
          .map((t) => `"${t.replace(/"/g, '""')}"`)
          .join(' ')
        if (safeQuery) {
          const rows = this.db.prepare(`
            SELECT ${ATOMIC_FACTS_COLUMNS.split(', ').map(c => 'f.' + c).join(', ')} FROM atomic_facts f
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
      SELECT ${ATOMIC_FACTS_COLUMNS} FROM atomic_facts WHERE evicted = 0
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
    // B2: Read all non-evicted facts, then group by canonicalized (subject, predicate).
    // This catches cross-spelling conflicts that a raw SQL GROUP BY on exact strings
    // would miss (e.g. "deploy" vs "deploy-command" vs "deploy_command").
    const allRows = this.db.prepare(`
      SELECT ${ATOMIC_FACTS_COLUMNS} FROM atomic_facts WHERE evicted = 0
    `).all() as RawFactRow[]

    const facts = allRows.map((r) => this.rowToFact(r))

    // Group by canonical (subject, predicate)
    const groups = new Map<string, AtomicFact[]>()
    for (const fact of facts) {
      const key = `${normalizeSubject(fact.subject)}\u0000${normalizePredicate(fact.predicate)}`
      const list = groups.get(key)
      if (list) list.push(fact)
      else groups.set(key, [fact])
    }

    // Keep only groups with >1 distinct object
    const conflicts: { subject: string; predicate: string; conflicts: AtomicFact[] }[] = []
    for (const list of groups.values()) {
      const distinctObjects = new Set(list.map((f) => f.object))
      if (distinctObjects.size <= 1) continue
      // B1: Sort by source weight (higher = more authoritative), then confidence.
      // The first item is deterministically the highest source-weight fact.
      list.sort((a, b) => {
        const w = (SOURCE_WEIGHTS[b.source] ?? 0) - (SOURCE_WEIGHTS[a.source] ?? 0)
        if (w !== 0) return w
        return b.confidence - a.confidence
      })
      conflicts.push({ subject: list[0].subject, predicate: list[0].predicate, conflicts: list })
    }

    return conflicts
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
    this.db.exec('DELETE FROM correction_event')
    this.db.exec('DELETE FROM task_unit')
    this.db.exec('DELETE FROM attribution_event')
    // P6: Rebuild FTS tables to remove stale index entries
    try {
      this.db.exec(`INSERT INTO experiences_fts(experiences_fts) VALUES('rebuild')`)
      this.db.exec(`INSERT INTO atomic_facts_fts(atomic_facts_fts) VALUES('rebuild')`)
    } catch { /* FTS tables may not exist yet */ }
  }
}

// 显式列名（AGENTS 4.10：禁用 SELECT *）。列集合必须与上表 schema / type 保持同步。
const EXPERIENCES_COLUMNS = 'id, session_id, turn_id, created_at, task_unit_id, goal_id, context_hash, content_hash, task_pattern, tools_used, workspace_digest, actions, outcome_score, user_feedback, lesson, difficulty, generation, last_injected_at, merged, tags, confidence, reuse_count, source, outcome_verdict, outcome_confidence, acceptance_criteria, transfer_confidence, semantic_key, memory_tier'
const TASK_UNIT_COLUMNS = 'id, goal_id, workspace_digest, acceptance_criteria, verdict, verdict_source, outcome_confidence, started_at, closed_at'
const CORRECTION_EVENT_COLUMNS = 'id, turn_id, session_id, type, seq, target_tool, target_seq_hash, user_text, intent, severity, created_at'
const ATOMIC_FACTS_COLUMNS = 'id, subject, predicate, object, source, confidence, created_at, updated_at, evicted'

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
  outcome_verdict: string | null
  outcome_confidence: number | null
  acceptance_criteria: string | null
  transfer_confidence: number | null
  semantic_key: string | null
  memory_tier: string | null
}

interface RawTaskUnitRow {
  id: string
  goal_id: string | null
  workspace_digest: string | null
  acceptance_criteria: string | null
  verdict: string | null
  verdict_source: string | null
  outcome_confidence: number | null
  started_at: number | null
  closed_at: number | null
}

interface RawCorrectionEventRow {
  id: string
  turn_id: string
  session_id: string
  type: CorrectionType
  seq: number
  target_tool: string | null
  target_seq_hash: string | null
  user_text: string
  intent: string | null
  severity: CorrectionSeverity
  created_at: number
}

function rowToCorrectionEvent(r: RawCorrectionEventRow): CorrectionEvent {
  return {
    id: r.id,
    turnId: r.turn_id,
    sessionId: r.session_id,
    type: r.type,
    seq: r.seq,
    targetTool: r.target_tool,
    targetSeqHash: r.target_seq_hash,
    userText: r.user_text,
    intent: r.intent,
    severity: r.severity,
    createdAt: r.created_at,
  }
}

// B1: Source weight ranking — higher = more authoritative
const SOURCE_WEIGHTS: Record<string, number> = {
  'user-confirmed': 4,
  'tool-derived': 3,
  'model-inferred': 2,
  'merged': 2,   // P7: Same weight as model-inferred (consolidated but not user-confirmed)
  'chat-mention': 1,
}

// ---------------------------------------------------------------------------
// B2: Topic normalization — canonicalize subject/predicate so that the same
// fact expressed in multiple ways collapses to a single key. This lets
// upsertFact() merge variants and detectFactConflicts() catch cross-spelling
// conflicts that exact string matching would miss.
//
// Deterministic (no LLM): only handles format variants and a small curated
// alias table. Semantic paraphrase is intentionally out of scope here.
// ---------------------------------------------------------------------------

// Predicate aliases — map variant spellings to one canonical predicate.
const PREDICATE_ALIASES: Record<string, string> = {
  'deploy-command': 'deploy-command',
  'deploy': 'deploy-command',
  'deployment-command': 'deploy-command',
  'deploy-cmd': 'deploy-command',
  'build-tool': 'build-tool',
  'build-command': 'build-tool',
  'build': 'build-tool',
  'test-command': 'test-command',
  'test': 'test-command',
  'run-tests': 'test-command',
  'effective-tool-sequence': 'effective-tool-sequence',
  'effective-tools': 'effective-tool-sequence',
  'failed-tool-sequence': 'failed-tool-sequence',
  'failed-tools': 'failed-tool-sequence',
  'task-type': 'task-type',
  'task-pattern': 'task-type',
}

/**
 * B2: Canonicalize a predicate string.
 * - Trim + lowercase
 * - Collapse runs of separators (`-`, `_`, whitespace) into a single `-`
 * - Map known aliases to a canonical form
 */
export function normalizePredicate(predicate: string): string {
  const folded = predicate.trim().toLowerCase()
    .replace(/[\s_]+/g, '-')          // underscore / whitespace → hyphen
    .replace(/-+/g, '-')              // collapse repeated hyphens
    .replace(/^-|-$/g, '')            // strip leading/trailing hyphens
  return PREDICATE_ALIASES[folded] ?? folded
}

/**
 * B2: Canonicalize a subject string.
 * - Trim + collapse internal whitespace
 * - Normalize the common `workspace:` prefix case
 * - Leave the digest/name body intact (it is already a stable hash or id)
 */
export function normalizeSubject(subject: string): string {
  const trimmed = subject.trim().replace(/\s+/g, ' ')
  // Normalize a leading "workspace:" / "project:" prefix to lowercase
  return trimmed.replace(/^(workspace|project):/i, (m) => m.toLowerCase())
}

/** B2: Canonical key for (subject, predicate) — used for upsert + conflict grouping. */
function normalizeFactKey(subject: string, predicate: string): { subject: string; predicate: string } {
  return { subject: normalizeSubject(subject), predicate: normalizePredicate(predicate) }
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
