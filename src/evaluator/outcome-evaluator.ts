/**
 * Outcome Evaluator — Layer 1 (test fixture)
 *
 * NOTE: This standalone class is used by tests only.
 * The runtime plugin (src/index.ts) inlines equivalent scoring logic.
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
  computeOutcomeScore,
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

    const outcomeScore = computeOutcomeScore({
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
