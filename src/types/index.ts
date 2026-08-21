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

  // Context signature
  contextHash: string
  taskPattern: string | null
  toolsUsed: string[] | null
  workspaceDigest: string | null

  // Action record
  actions: string // JSON: tool call sequence summary

  // Outcome and lesson
  outcomeScore: number
  userFeedback: string
  lesson: string | null

  // Indexing
  tags: string[] | null
  confidence: number
  reuseCount: number
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
  goalProgress: 0.4,
  toolSuccess: 0.25,
  guardPenalty: 0.15,
  userFeedback: 0.2,
} as const

export const GUARD_PENALTY_PER_TRIGGER = 0.1
export const MIN_OUTCOME_SCORE = 0.0
export const MAX_OUTCOME_SCORE = 1.0
