/**
 * Outcome Evaluator — Layer 1
 *
 * Mounted on agent/turn-stopping (serial event, fires before a turn closes).
 * This is the last chance to observe a complete turn in flight.
 *
 * The evaluator is READ-ONLY — it observes turn output, does not modify
 * agent behavior. This guarantees the deterministic loop is unaffected.
 */

import type { ExperienceStore } from '../store/experience-store.js'
import {
  type TurnOutcome,
  type TurnData,
  SCORE_WEIGHTS,
  GUARD_PENALTY_PER_TRIGGER,
  MAX_OUTCOME_SCORE,
  MIN_OUTCOME_SCORE,
  computeStepEfficiency,
  computeDifficulty,
} from '../types/index.js'

export class OutcomeEvaluator {
  private store: ExperienceStore

  constructor(store: ExperienceStore) {
    this.store = store
  }

  // -------------------------------------------------------------------------
  // Core evaluation logic
  // -------------------------------------------------------------------------

  /**
   * Evaluate a turn's outcome and produce a TurnOutcome.
   * This is the pure scoring function — no side effects.
   */
  evaluate(data: TurnData): TurnOutcome {
    const toolCallCount = data.toolResults.length
    const successCount = data.toolResults.filter((r) => r.success).length
    const toolSuccessRate =
      toolCallCount > 0 ? successCount / toolCallCount : 0.0

    // P0: Step efficiency — use stepCount if available, else fall back to toolCallCount
    const stepCount = data.stepCount ?? toolCallCount
    const stepEfficiency = computeStepEfficiency(stepCount)

    // P0: Determine difficulty
    const hasFailures = data.toolResults.some((r) => !r.success)
    const difficulty = computeDifficulty(stepCount, hasFailures)

    const outcomeScore = this.computeScore({
      goalProgress: data.goalProgress,
      toolSuccessRate,
      stepEfficiency,
      guardTriggerCount: data.guardTriggers.length,
      userFeedback: data.userFeedback,
    })

    return {
      turnId: data.turnId,
      sessionId: data.sessionId,
      goalProgress: data.goalProgress,
      toolCallCount,
      toolSuccessRate,
      guardTriggerCount: data.guardTriggers.length,
      userFeedback: data.userFeedback,
      stepEfficiency,
      difficulty,
      outcomeScore,
      timestamp: data.timestamp,
    }
  }

  /**
   * Evaluate a turn AND store the result in the Experience Store.
   * This is the method to call from the agent/turn-stopping hook.
   */
  evaluateAndStore(
    data: TurnData,
    context: {
      taskPattern: string | null
      toolsUsed: string[] | null
      workspaceDigest: string | null
      tags?: string[]
    },
  ): string {
    const outcome = this.evaluate(data)
    const actions = this.summarizeActions(data)

    return this.store.store(outcome, {
      taskPattern: context.taskPattern,
      toolsUsed: context.toolsUsed,
      workspaceDigest: context.workspaceDigest,
      actions,
      tags: context.tags,
    })
  }

  // -------------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------------

  /**
   * Compute a composite outcome score from individual signals.
   *
   * Weights (from SCORE_WEIGHTS):
   *   goalProgress:   0.30 — most important: did the turn actually advance?
   *   toolSuccess:    0.20 — tool call success rate
   *   stepEfficiency:  0.25 — fewer steps = more efficient
   *   guardPenalty:   0.15 — subtracted for each guard trigger
   *   userFeedback:   0.10 — user satisfaction signal (lower weight: P1 implicit negative)
   */
  private computeScore(input: {
    goalProgress: TurnOutcome['goalProgress']
    toolSuccessRate: number
    stepEfficiency: number
    guardTriggerCount: number
    userFeedback: TurnOutcome['userFeedback']
  }): number {
    // Goal progress component
    const goalScore = this.goalProgressScore(input.goalProgress)
    const goalComponent = goalScore * SCORE_WEIGHTS.goalProgress

    // Tool success component
    const toolComponent = input.toolSuccessRate * SCORE_WEIGHTS.toolSuccess

    // P0: Step efficiency component
    const efficiencyComponent = input.stepEfficiency * SCORE_WEIGHTS.stepEfficiency

    // Guard penalty (subtracted from the guard weight)
    const guardPenalty = Math.min(
      input.guardTriggerCount * GUARD_PENALTY_PER_TRIGGER,
      SCORE_WEIGHTS.guardPenalty,
    )
    const guardComponent = SCORE_WEIGHTS.guardPenalty - guardPenalty

    // User feedback component
    const feedbackScore = this.feedbackScore(input.userFeedback)
    const feedbackComponent = feedbackScore * SCORE_WEIGHTS.userFeedback

    const total = goalComponent + toolComponent + efficiencyComponent + guardComponent + feedbackComponent

    return Math.max(
      MIN_OUTCOME_SCORE,
      Math.min(MAX_OUTCOME_SCORE, total),
    )
  }

  private goalProgressScore(progress: TurnOutcome['goalProgress']): number {
    switch (progress) {
      case 'advanced':
        return 1.0
      case 'stalled':
        return 0.3
      case 'regressed':
        return 0.0
      case 'none':
        return 0.5
    }
  }

  private feedbackScore(feedback: TurnOutcome['userFeedback']): number {
    switch (feedback) {
      case 'positive':
        return 1.0
      case 'negative':
        return 0.0
      case 'none':
        return 0.5
    }
  }

  // -------------------------------------------------------------------------
  // Action summarization
  // -------------------------------------------------------------------------

  /**
   * Create a compact JSON summary of the tool call sequence for storage.
   */
  private summarizeActions(data: TurnData): string {
    const summary = data.toolResults.map((r) => ({
      tool: r.toolName,
      ok: r.success,
      ms: Math.round(r.durationMs),
    }))

    const guards = data.guardTriggers.map((g) => ({
      guard: g.guardName,
      reason: g.reason,
    }))

    return JSON.stringify({
      tools: summary,
      guards,
      goalProgress: data.goalProgress,
      feedback: data.userFeedback,
    })
  }
}
