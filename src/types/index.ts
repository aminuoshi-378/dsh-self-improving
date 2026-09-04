/**
 * Type definitions for the self-improving learning layer.
 *
 * These interfaces are the shared contract between all four layers:
 *   Layer 1 (Outcome Evaluator) → produces TurnOutcome
 *   Layer 2 (Behavior Adapter)  → consumes ExperienceRecord for injection
 *   Layer 3 (Experience Store)  → stores/retrieves ExperienceRecord
 *   Layer 4 (Meta-Cognition)    → produces Reflection and updates ExperienceRecord
 */

import {
  STEP_EFFICIENCY_DECAY,
  LOW_DIFFICULTY_MAX_STEPS,
  MEDIUM_DIFFICULTY_MAX_STEPS,
  VERDICT_CONFIDENCE_L0,
  VERDICT_CONFIDENCE_L1,
  VERDICT_CONFIDENCE_L2,
  VERDICT_CONFIDENCE_L3,
} from './constants.js'

// ---------------------------------------------------------------------------
// Layer 1: Outcome Evaluator
// ---------------------------------------------------------------------------

/**
 * The result of evaluating a single turn's output quality.
 * Produced by the Outcome Evaluator, consumed by the Experience Store.
 */
export interface TurnOutcome {
  turnId: string
  sessionId: string
  goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none'
  toolCallCount: number
  toolSuccessRate: number // 0.0–1.0
  guardTriggerCount: number
  userFeedback: 'positive' | 'negative' | 'none'
  /** Step efficiency score 0.0–1.0: fewer steps → higher score. */
  stepEfficiency: number
  /** Task difficulty: low (1-2 steps all success), medium (3-6 steps), high (7+ steps or had failures). */
  difficulty: 'low' | 'medium' | 'high'
  /** Composite score 0.0–1.0, weighted from the fields above. */
  outcomeScore: number
  timestamp: number
}

// ---------------------------------------------------------------------------
// Truth-ground layer (v2)
// ---------------------------------------------------------------------------

/**
 * The task-unit-level result verdict — the "did the task actually get done"
 * signal that v1's turn-level scoring lacked.
 * - pass:    the task was confirmed done (user feedback or acceptance criteria).
 * - fail:    the task was confirmed NOT done.
 * - unknown: no trustworthy signal available; must NOT be treated as success.
 */
export type OutcomeVerdict = 'pass' | 'fail' | 'unknown'

/**
 * The provenance level of a verdict, ordered by trustworthiness.
 * L0 = user-confirmed, L1 = acceptance-criteria self-check, L2 = hard observable
 * fact (exit code / test result), L3 = process-proxy weak prior.
 */
export type VerdictSource = 'L0' | 'L1' | 'L2' | 'L3'

/**
 * A task-unit-level outcome, produced when a TaskUnit closes.
 * This is the ground-truth record that v1's per-turn `TurnOutcome` feeds into.
 */
export interface TaskUnitOutcome {
  taskUnitId: string
  goalId: string | null
  workspaceDigest: string | null
  /** The resolved verdict. */
  verdict: OutcomeVerdict
  /** Which signal level produced the verdict. */
  source: VerdictSource
  /** Confidence that the verdict itself is correct (0.0–1.0), derived from source. */
  outcomeConfidence: number
  /** Acceptance criteria generated at task start (L1 input), when present. */
  acceptanceCriteria: string | null
  /** Unix epoch ms when the TaskUnit closed. */
  closedAt: number
}

/**
 * Map a verdict source level to the confidence that the verdict is correct.
 * L0 (user) is fully trusted; L3 (process proxy) is a weak prior.
 */
export function computeVerdictConfidence(source: VerdictSource): number {
  switch (source) {
    case 'L0': return VERDICT_CONFIDENCE_L0
    case 'L1': return VERDICT_CONFIDENCE_L1
    case 'L2': return VERDICT_CONFIDENCE_L2
    case 'L3': return VERDICT_CONFIDENCE_L3
  }
}

/**
 * Raw data collected during a turn for evaluation.
 * The evaluator reads this and produces a TurnOutcome.
 */
export interface TurnData {
  turnId: string
  sessionId: string
  goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none'
  toolResults: ToolResultEntry[]
  guardTriggers: GuardTrigger[]
  userFeedback: 'positive' | 'negative' | 'none'
  /** Number of agent steps in this turn (for efficiency calculation). */
  stepCount?: number
  timestamp: number
}

export interface ToolResultEntry {
  toolName: string
  success: boolean
  durationMs: number
}

export interface GuardTrigger {
  guardName: string
  reason: string
}

// ---------------------------------------------------------------------------
// Layer 3: Experience Store
// ---------------------------------------------------------------------------

/**
 * A stored experience record — the (context, action, outcome, lesson) tuple.
 */
export interface ExperienceRecord {
  id: string // ULID
  sessionId: string
  turnId: string
  createdAt: number

  // Task unit (P-C: cross-turn aggregation)
  taskUnitId: string // ULID grouping turns into a task unit
  goalId: string | null // dsh goal id if this turn belongs to a goal-driven task

  // Context signature
  contextHash: string
  contentHash: string | null // E2: sha1 of ordered tool sequence (with success/failure) + workspace
  taskPattern: string | null
  toolsUsed: string[] | null
  workspaceDigest: string | null

  // Action record
  actions: string // JSON: tool call sequence summary

  // Outcome and lesson
  outcomeScore: number
  userFeedback: string
  lesson: string | null // JSON string of Reflection, or plain text for legacy

  // Task difficulty
  difficulty: 'low' | 'medium' | 'high'

  // Generational GC fields
  generation: number // 0 = young gen, 1 = old gen
  lastInjectedAt: number | null // timestamp of last injection
  merged: boolean // true if this record has been merged into another

  // Indexing
  tags: string[] | null
  confidence: number
  reuseCount: number
  source: string // B1: 'user-confirmed' | 'tool-derived' | 'model-inferred' | 'chat-mention'
  /** v2: transfer usefulness (how well this experience transfers to new tasks), driven by bidirectional attribution. */
  transferConfidence: number
  /** v2: semantic signature of the task (LLM-reduced, or rule-based fallback). Used for semantic retrieval + clustering. */
  semanticKey: string | null
  /** v2: cognitive value tier ('event' raw record vs 'strategy' transferable practice). */
  memoryTier: 'event' | 'strategy'
}

/**
 * Query parameters for retrieving similar experiences.
 */
export interface ExperienceQuery {
  taskPattern?: string
  toolsUsed?: string[]
  workspaceDigest?: string
  limit?: number
  minScore?: number
  searchText?: string // A3: FTS5 full-text search keyword for lesson/actions
}

/**
 * The result of a reflection — produced by Layer 4, stored in the lesson field.
 */
export interface Reflection {
  whatWorked: string
  whatFailed: string
  whatToTryDifferently: string
  reusableLesson: string
}

// ---------------------------------------------------------------------------
// Layer 2: Behavior Adapter
// ---------------------------------------------------------------------------

/**
 * Formatted experience summary for injection into agent context.
 */
export interface ExperienceSummary {
  whatWorked: string | null
  whatFailed: string | null
  suggestedApproach: string | null
  matchingRecords: number
}

/**
 * Learned behavioral preferences for system prompt injection.
 */
export interface LearnedPreference {
  key: string
  value: string
  confidence: number
}

// ---------------------------------------------------------------------------
// Scoring weights for outcome evaluation
// ---------------------------------------------------------------------------

export const SCORE_WEIGHTS = {
  goalProgress: 0.3,
  toolSuccess: 0.2,
  stepEfficiency: 0.25,
  guardPenalty: 0.15,
  userFeedback: 0.1,
} as const

export const GUARD_PENALTY_PER_TRIGGER = 0.1
export const MIN_OUTCOME_SCORE = 0.0
export const MAX_OUTCOME_SCORE = 1.0

/**
 * Compute step efficiency score: fewer steps → higher score.
 * Formula: max(0, 1 - (stepCount - 1) * 0.05)
 * 1 step = 1.0, 3 steps = 0.9, 10 steps = 0.55, 20 steps = 0.05
 */
export function computeStepEfficiency(stepCount: number): number {
  if (stepCount <= 1) return 1.0
  return Math.max(0, 1 - (stepCount - 1) * STEP_EFFICIENCY_DECAY)
}

/**
 * Determine task difficulty from step count and failure presence.
 * - low: 1-2 steps, all successful
 * - medium: 3-6 steps
 * - high: 7+ steps OR had any failures
 */
export function computeDifficulty(
  stepCount: number,
  hasFailures: boolean,
): 'low' | 'medium' | 'high' {
  if (hasFailures) return 'high'
  if (stepCount <= LOW_DIFFICULTY_MAX_STEPS) return 'low'
  if (stepCount <= MEDIUM_DIFFICULTY_MAX_STEPS) return 'medium'
  return 'high'
}

/**
 * Map a goal progress state to its score component (0.0–1.0).
 */
export function goalProgressScore(progress: 'advanced' | 'stalled' | 'regressed' | 'none'): number {
  switch (progress) {
    case 'advanced': return 1.0
    case 'stalled': return 0.3
    case 'regressed': return 0.0
    case 'none': return 0.5
  }
}

/**
 * Map a user feedback state to its score component (0.0–1.0).
 */
export function feedbackScore(feedback: 'positive' | 'negative' | 'none'): number {
  switch (feedback) {
    case 'positive': return 1.0
    case 'negative': return 0.0
    case 'none': return 0.6 // P1: neutral = 0.6 (not 0.5)
  }
}

/**
 * I7: Single source of truth for the outcome score formula.
 *
 * Previously this formula was duplicated in `index.ts` (runtime) and
 * `OutcomeEvaluator.computeScore` (test fixture), which drifted apart
 * (see O7 neutral feedback bug). Consolidating here eliminates the dual-track.
 *
 * Weights (SCORE_WEIGHTS): goalProgress 0.3 + toolSuccess 0.2 +
 * stepEfficiency 0.25 + guardPenalty 0.15 + userFeedback 0.1.
 */
export function computeOutcomeScore(input: {
  goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none'
  toolSuccessRate: number
  stepEfficiency: number
  guardTriggerCount: number
  userFeedback: 'positive' | 'negative' | 'none'
  /** Correction signal (optional) — replaces the coarse implicitNegative bool. */
  correctionSignal?: CorrectionSignal
}): number {
  const goalComponent = goalProgressScore(input.goalProgress) * SCORE_WEIGHTS.goalProgress
  const toolComponent = input.toolSuccessRate * SCORE_WEIGHTS.toolSuccess
  const efficiencyComponent = input.stepEfficiency * SCORE_WEIGHTS.stepEfficiency
  const guardPenalty = Math.min(
    input.guardTriggerCount * GUARD_PENALTY_PER_TRIGGER,
    SCORE_WEIGHTS.guardPenalty,
  )
  const guardComponent = SCORE_WEIGHTS.guardPenalty - guardPenalty
  const feedbackComponent = feedbackScore(input.userFeedback) * SCORE_WEIGHTS.userFeedback

  let total = goalComponent + toolComponent + efficiencyComponent + guardComponent + feedbackComponent
  // Correction dimension: the larger the correction signal, the more we clamp the
  // score downward. redo is deliberately neutral here (its positive half is learned
  // via the contrast lesson, not via blunt penalty) — see correctionSeverityWeight.
  const penalty = correctionPenalty(input.correctionSignal)
  total -= penalty
  return Math.max(MIN_OUTCOME_SCORE, Math.min(MAX_OUTCOME_SCORE, total))
}

// ---------------------------------------------------------------------------
// Correction events (重构计划：以「用户纠正」为黄金信号)
// ---------------------------------------------------------------------------

/**
 * Four-class classification of a user correction signal.
 * - revert:      回退/否定/撤回 (用户让 agent 撤销某结果/做法)
 * - redo:        重做/换个方式/再来 (用户让 agent 重新做)
 * - correction:  纠正/相悖/替代做法 (用户指出结果不对，给出修正方向)
 * - interrupt:   打断-重输 (用户不等生成结束直接暂停并重新输入，绕过关键词)
 */
export type CorrectionType = 'correction' | 'revert' | 'redo' | 'interrupt'

export type CorrectionSeverity = 'high' | 'medium' | 'low'

/**
 * A structured correction event — the atomic record of where and how the user
 * corrected the agent. Created by the detection layer, stored in the
 * `correction_event` table, consumed by scoring / lesson / injection.
 */
export interface CorrectionEvent {
  id: string
  turnId: string
  sessionId: string
  type: CorrectionType
  /** The seq of the user message in the session event stream. */
  seq: number
  /** The tool (name) the correction pointed at, when localizable. */
  targetTool: string | null
  /** The tool-sequence content hash the correction pointed at (反查经验). */
  targetSeqHash: string | null
  /** Raw user correction text (truncated on storage). */
  userText: string
  /** Parsed correction intent / alternative direction (LLM, optional). */
  intent: string | null
  /** revert / client-reject → high; correction → medium; redo/interrupt → medium-low. */
  severity: CorrectionSeverity
  createdAt: number
}

/** Parsed signal feeding the scoring layer (replaces the implicitNegative bool). */
export interface CorrectionSignal {
  count: number
  /** Highest severity among this turn's corrections. */
  severity: CorrectionSeverity | null
}

/**
 * Compute a correction penalty (0.0–1.0) from a correction signal.
 * revert/correction clamp strong downward; redo (对比对) is neutral-ish here —
 * its positive half is learned via lesson contrast instead of blunt penalty.
 */
export function correctionPenalty(signal: CorrectionSignal | undefined): number {
  if (!signal || signal.count <= 0) return 0
  const perEvent = correctionSeverityWeight(signal.severity)
  return Math.min(1, signal.count * perEvent)
}

/** Map a correction severity to a per-event weight used by correctionPenalty. */
export function correctionSeverityWeight(severity: CorrectionSeverity | null): number {
  switch (severity) {
    case 'high': return 0.25
    case 'medium': return 0.15
    case 'low': return 0.05
    default: return 0.15
  }
}

/**
 * Parse a lesson field that may be JSON (Reflection) or plain text (legacy).
 * Returns the reusable_lesson from JSON, or the raw text if not JSON.
 */
export function extractLessonText(lesson: string | null): string | null {
  if (!lesson) return null
  try {
    const parsed = JSON.parse(lesson)
    if (parsed && typeof parsed.reusable_lesson === 'string') {
      return parsed.reusable_lesson
    }
    if (parsed && typeof parsed.reusableLesson === 'string') {
      return parsed.reusableLesson
    }
  } catch {
    // Not JSON — return raw text
  }
  return lesson
}

// ---------------------------------------------------------------------------
// P5: Task pattern inference
// ---------------------------------------------------------------------------

/**
 * Known task patterns for classification.
 */
export type TaskPattern = 'bugfix' | 'feature' | 'refactoring' | 'search' | 'test-writing' | 'general'

/**
 * P5: Infer task pattern from the agent's first user message text.
 * Uses keyword matching to classify the task type.
 *
 * - bugfix: fix, bug, error, crash, broken, issue, fail, broken
 * - feature: add, create, implement, build, new, feature
 * - refactoring: refactor, clean, rename, restructure, optimize, simplify
 * - search: find, search, grep, locate, where, list
 * - test-writing: test, spec, coverage
 * - general: fallback
 */
export function inferTaskPattern(userMessage: string): TaskPattern {
  const text = userMessage.toLowerCase()

  const patterns: { pattern: TaskPattern; keywords: string[] }[] = [
    { pattern: 'bugfix', keywords: ['fix', 'bug', 'error', 'crash', 'broken', 'issue', 'fail', 'exception', 'stack trace'] },
    { pattern: 'feature', keywords: ['add', 'create', 'implement', 'build', 'new feature', 'develop', 'generate'] },
    { pattern: 'refactoring', keywords: ['refactor', 'clean', 'rename', 'restructure', 'optimize', 'simplify', 'extract', 'inline'] },
    { pattern: 'test-writing', keywords: ['test', 'spec', 'coverage', 'mock', 'assert', 'jest', 'vitest'] },
    { pattern: 'search', keywords: ['find', 'search', 'grep', 'locate', 'where', 'list', 'show me'] },
  ]

  for (const { pattern, keywords } of patterns) {
    for (const kw of keywords) {
      if (text.includes(kw)) return pattern
    }
  }

  return 'general'
}

/**
 * P5: Export experiences as JSON for transfer/backup.
 * Returns an array of plain objects suitable for JSON serialization.
 */
export interface ExportedExperience {
  id: string
  outcomeScore: number
  toolsUsed: string[] | null
  lesson: string | null
  difficulty: 'low' | 'medium' | 'high'
  taskPattern: string | null
  taskUnitId: string
  goalId: string | null
  generation: number
  merged: boolean
  confidence: number
  reuseCount: number
  createdAt: number
  actions: string
  source: string
  contentHash: string | null
}

/**
 * P5: Validate an imported experience object.
 * Returns true if the object has the required fields with correct types.
 */
export function isValidImportedExperience(obj: unknown): obj is ExportedExperience {
  if (typeof obj !== 'object' || obj === null) return false
  const r = obj as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.outcomeScore === 'number' &&
    (r.toolsUsed === null || (Array.isArray(r.toolsUsed) && r.toolsUsed.every((t: unknown) => typeof t === 'string'))) &&
    (r.lesson === null || typeof r.lesson === 'string') &&
    (r.difficulty === 'low' || r.difficulty === 'medium' || r.difficulty === 'high') &&
    (r.taskPattern === null || typeof r.taskPattern === 'string') &&
    typeof r.generation === 'number' &&
    typeof r.merged === 'boolean' &&
    typeof r.confidence === 'number' &&
    typeof r.reuseCount === 'number' &&
    typeof r.createdAt === 'number' &&
    typeof r.actions === 'string' &&
    // J3: source is required, contentHash is optional (may be null for old exports)
    typeof r.source === 'string'
  )
}
