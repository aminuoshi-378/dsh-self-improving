/**
 * Type definitions for the self-improving learning layer.
 *
 * These interfaces are the shared contract between all four layers:
 *   Layer 1 (Outcome Evaluator) → produces TurnOutcome
 *   Layer 2 (Behavior Adapter)  → consumes ExperienceRecord for injection
 *   Layer 3 (Experience Store)  → stores/retrieves ExperienceRecord
 *   Layer 4 (Meta-Cognition)    → produces Reflection and updates ExperienceRecord
 */

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
  return Math.max(0, 1 - (stepCount - 1) * 0.05)
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
  if (stepCount <= 2) return 'low'
  if (stepCount <= 6) return 'medium'
  return 'high'
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
    typeof r.actions === 'string'
  )
}
