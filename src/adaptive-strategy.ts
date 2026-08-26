/**
 * Adaptive strategy — Phase 6 (self-tuning runtime behavior).
 *
 * Two deterministic, data-driven policies that let the plugin adjust runtime
 * behavior from accumulated experience, without any LLM:
 *
 * 1. `selectModel`   — pick a stronger/weaker model for a task type based on
 *                      historical outcome scores (feeds `agent/request`).
 * 2. `guardTool`     — deny or warn on a tool call whose name appears
 *                      repeatedly in past *failed* tool sequences
 *                      (feeds `tools/pre-execute`).
 *
 * Both are pure functions over `ExperienceStore` + a small input, so they are
 * unit-testable in isolation from dsh's event wiring. The `index.ts` listeners
 * are thin adapters that call `next()` first (waterfall contract) and only
 * override the result when the policy returns a concrete recommendation.
 */

import type { ExperienceStore } from './store/experience-store.js'

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

/** Minimum number of recorded experiences before a task-type model suggestion is made. */
const MIN_SAMPLES_FOR_MODEL_SELECTION = 5

/** Outcome score at or above which the standard (cheaper) model is considered sufficient. */
const STRONG_MODEL_SCORE_THRESHOLD = 0.8
/** Outcome score at or below which a stronger (reasoning) model is recommended. */
const WEAK_MODEL_SCORE_THRESHOLD = 0.5

export interface ModelSuggestion {
  /** Provider-owned model id to switch to. */
  model: string
  /** Human-readable rationale, used for logging. */
  reason: string
}

/**
 * Phase 6-1: Recommend a model for a task type from historical outcomes.
 *
 * - Not enough samples (< MIN_SAMPLES) → null (no recommendation).
 * - avg score >= 0.8 → standard model is sufficient (return `standardModel`).
 * - avg score < 0.5 → recommend the stronger reasoning model.
 * - in between → null (keep the current model).
 *
 * `strongModel`/`standardModel` come from plugin config; when `strongModel` is
 * empty the policy is disabled (returns null), so callers that never configure
 * a strong model pay nothing and change nothing.
 *
 * @param taskPattern - inferred task type (bugfix/feature/…) or null/undefined.
 * @param store - experience store to read historical outcomes from.
 * @param strongModel - configured strong (reasoning) model id, or empty.
 * @param standardModel - configured standard model id, or empty.
 */
export function selectModel(
  taskPattern: string | null | undefined,
  store: ExperienceStore,
  strongModel: string,
  standardModel: string,
): ModelSuggestion | null {
  if (!strongModel) return null

  // Use taskPatternStats (no content-hash dedup) so every historical attempt
  // contributes to the success-rate estimate, not just the best per tool sequence.
  const { count, avgScore } = store.taskPatternStats(taskPattern ?? undefined)

  if (count < MIN_SAMPLES_FOR_MODEL_SELECTION) return null

  if (avgScore >= STRONG_MODEL_SCORE_THRESHOLD && standardModel) {
    return {
      model: standardModel,
      reason: `Historical avg score ${avgScore.toFixed(2)} for "${taskPattern ?? 'general'}" — standard model sufficient`,
    }
  }

  if (avgScore < WEAK_MODEL_SCORE_THRESHOLD) {
    return {
      model: strongModel,
      reason: `Historical avg score ${avgScore.toFixed(2)} for "${taskPattern ?? 'general'}" — stronger reasoning model recommended`,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Tool guarding
// ---------------------------------------------------------------------------

export type ToolGuardDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }

/**
 * Phase 6-2: Decide whether to deny a tool call based on past failures.
 *
 * Counts how many distinct *failed* experiences (outcome_score <= 0.3) used
 * `toolName`. If that count reaches `denyThreshold`, the call is denied with a
 * corrective reason; otherwise it is allowed.
 *
 * Denial is deliberately conservative: it requires multiple independent
 * failures (each counted once per failed experience, not per tool call), and
 * the threshold is configurable so a single bad day doesn't lock a tool out
 * permanently.
 *
 * @param toolName - the tool about to execute.
 * @param store - experience store to read failure history from.
 * @param denyThreshold - number of distinct failed experiences before denying.
 */
export function guardTool(
  toolName: string,
  store: ExperienceStore,
  denyThreshold: number,
): ToolGuardDecision {
  if (denyThreshold <= 0) return { kind: 'allow' }

  const counts = store.failedToolCounts(denyThreshold)
  const failureCount = counts.get(toolName) ?? 0

  if (failureCount >= denyThreshold) {
    return {
      kind: 'deny',
      reason: `"${toolName}" has failed in ${failureCount} distinct experiences — consider a different tool or approach`,
    }
  }

  return { kind: 'allow' }
}
