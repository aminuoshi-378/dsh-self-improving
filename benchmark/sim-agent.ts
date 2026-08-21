/**
 * Simulated Agent — produces realistic TurnData for benchmarking.
 *
 * The simulator walks a task's optimal path, but introduces mistakes
 * based on whether learned experience is available:
 *
 *   WITHOUT experience (baseline):
 *     - Mistakes fire at their full probability
 *     - Wrong tools get called, tools get repeated, unnecessary steps happen
 *     - Goal progress: often "stalled" or "regressed"
 *
 *   WITH experience (enabled):
 *     - Mistake probability drops ~70% (experience was injected as advisory)
 *     - Agent follows optimal path more closely
 *     - Goal progress: usually "advanced"
 *
 * This is NOT a real LLM — it's a deterministic simulation that produces
 * realistic TurnData for the OutcomeEvaluator to score.
 *
 * The simulation is seeded for reproducibility: same seed → same results.
 */

import type { TaskScenario } from './task-suite.js'
import type { TurnData, ToolResultEntry, GuardTrigger } from '../src/types/index.js'

export interface SimResult {
  turns: TurnData[]
  totalToolCalls: number
  totalSuccessCalls: number
  totalGuardTriggers: number
  completedTasks: number
  totalTokens: number
  outcomeScores: number[]
}

/**
 * A simple seeded PRNG for reproducible benchmarks.
 * Uses mulberry32 — fast, deterministic, good enough for simulation.
 */
function createRng(seed: number) {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class SimAgent {
  private rng: () => number

  /**
   * @param seed  Reproducibility seed. Same seed → same task outcomes.
   * @param hasExperience  Whether the agent has learned experience injected.
   *                       When true, mistake probability drops ~70%.
   */
  constructor(
    seed: number = 42,
    private hasExperience: boolean = false,
  ) {
    this.rng = createRng(seed)
  }

  /**
   * Run a single task scenario and produce one or more turns of TurnData.
   */
  runTask(task: TaskScenario): TurnData[] {
    const turns: TurnData[] = []
    const sessionId = `sim-${task.id}`

    // The agent walks the optimal path, but may deviate
    const toolResults: ToolResultEntry[] = []
    const guardTriggers: GuardTrigger[] = []
    let lastTool = ''
    let goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none' = 'advanced'

    for (const step of task.optimalPath) {
      // Determine if a mistake fires
      const mistakeRoll = this.rng()
      const mistakeFactor = this.hasExperience ? 0.25 : 1.0 // 75% reduction with experience

      // Check for wrong tool mistake
      if (task.mistakes.wrongTool && mistakeRoll < task.mistakes.wrongTool.probability * mistakeFactor) {
        const wrongTool = task.mistakes.wrongTool.tool
        toolResults.push({
          toolName: wrongTool,
          success: false,
          durationMs: 150 + Math.floor(this.rng() * 200),
        })
        // After wrong tool, the agent realizes and uses the correct one
        toolResults.push({
          toolName: step,
          success: true,
          durationMs: 100 + Math.floor(this.rng() * 150),
        })
        lastTool = step
        continue
      }

      // Check for repeat call mistake
      if (
        task.mistakes.repeatCall &&
        step === task.mistakes.repeatCall.tool &&
        mistakeRoll < task.mistakes.repeatCall.probability * mistakeFactor
      ) {
        // Call the tool twice (triggers guard)
        toolResults.push({
          toolName: step,
          success: true,
          durationMs: 100 + Math.floor(this.rng() * 100),
        })
        toolResults.push({
          toolName: step,
          success: true,
          durationMs: 100 + Math.floor(this.rng() * 100),
        })
        guardTriggers.push({
          guardName: 'repeat-tool-reminder',
          reason: `consecutive identical call: ${step}`,
        })
        lastTool = step
        continue
      }

      // Check for extra unnecessary step
      if (task.mistakes.extraStep && mistakeRoll < task.mistakes.extraStep.probability * mistakeFactor) {
        const extra = task.mistakes.extraStep.tool
        toolResults.push({
          toolName: extra,
          success: true,
          durationMs: 80 + Math.floor(this.rng() * 120),
        })
      }

      // Normal optimal step
      toolResults.push({
        toolName: step,
        success: true,
        durationMs: 80 + Math.floor(this.rng() * 120),
      })
      lastTool = step
    }

    // Check for stalls
    if (task.mistakes.stalls) {
      const stallRoll = this.rng()
      const stallFactor = this.hasExperience ? 0.25 : 1.0
      if (stallRoll < task.mistakes.stalls.probability * stallFactor) {
        goalProgress = 'stalled'
        // Add a couple extra failed attempts
        for (let i = 0; i < 2; i++) {
          toolResults.push({
            toolName: lastTool || 'grep',
            success: false,
            durationMs: 200 + Math.floor(this.rng() * 200),
          })
          guardTriggers.push({
            guardName: 'repeat-tool-reminder',
            reason: 'stuck in retry loop',
          })
        }
      }
    }

    // Determine user feedback
    const hadFailures = toolResults.some((r) => !r.success)
    const hadGuards = guardTriggers.length > 0
    const userFeedback =
      hadFailures && hadGuards
        ? task.feedbackOnFailure
        : !hadFailures && !hadGuards
          ? task.feedbackOnSuccess
          : 'none' as const

    // If goal stalled but had no explicit failures, mark as stalled
    if (goalProgress === 'advanced' && hadFailures && hadGuards) {
      goalProgress = 'stalled'
    }

    const turn: TurnData = {
      turnId: `turn-${task.id}-1`,
      sessionId,
      goalProgress,
      toolResults,
      guardTriggers,
      userFeedback,
      timestamp: Date.now(),
    }

    turns.push(turn)
    return turns
  }

  /**
   * Run all tasks in a suite and return aggregate results.
   */
  runSuite(tasks: TaskScenario[]): SimResult {
    const allTurns: TurnData[] = []
    let totalToolCalls = 0
    let totalSuccessCalls = 0
    let totalGuardTriggers = 0
    let completedTasks = 0
    let totalTokens = 0
    const outcomeScores: number[] = []

    for (const task of tasks) {
      const turns = this.runTask(task)
      allTurns.push(...turns)

      for (const turn of turns) {
        totalToolCalls += turn.toolResults.length
        totalSuccessCalls += turn.toolResults.filter((r) => r.success).length
        totalGuardTriggers += turn.guardTriggers.length

        // Simulate token cost: ~200 tokens per tool call + 500 base per turn
        totalTokens += 500 + turn.toolResults.length * 200

        // Rough outcome score calculation (same weights as OutcomeEvaluator)
        const toolSuccessRate =
          turn.toolResults.length > 0
            ? turn.toolResults.filter((r) => r.success).length / turn.toolResults.length
            : 0
        const goalScore =
          turn.goalProgress === 'advanced' ? 1.0 :
          turn.goalProgress === 'stalled' ? 0.3 :
          turn.goalProgress === 'regressed' ? 0.0 : 0.5
        const guardPenalty = Math.min(
          turn.guardTriggers.length * 0.1,
          0.15,
        )
        const feedbackScore =
          turn.userFeedback === 'positive' ? 1.0 :
          turn.userFeedback === 'negative' ? 0.0 : 0.5

        const score = Math.max(
          0,
          Math.min(
            1,
            goalScore * 0.4 +
            toolSuccessRate * 0.25 +
            (0.15 - guardPenalty) +
            feedbackScore * 0.2,
          ),
        )
        outcomeScores.push(score)

        if (turn.goalProgress === 'advanced') {
          completedTasks++
        }
      }
    }

    return {
      turns: allTurns,
      totalToolCalls,
      totalSuccessCalls,
      totalGuardTriggers,
      completedTasks,
      totalTokens,
      outcomeScores,
    }
  }
}
