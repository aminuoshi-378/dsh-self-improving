/**
 * dsh-self-improving — Plugin Entry Point for real dsh runtime.
 *
 * Mounts the four-layer learning system onto dsh's actual event hooks:
 *
 *   Layer 1: Outcome Evaluator     → tools/result (observe tool outcomes)
 *   Layer 2: Behavior Adapter       → agent/pre-step (inject experience)
 *                                     systemPrompt.section (learned prefs)
 *   Layer 3: Experience Store      → SQLite sidecar table
 *   Layer 4: Meta-Cognition Engine  → agent/turn-stopping (queue reflection)
 *                                     agent.runMaintenance (process queue)
 *
 * All injection is advisory — the model can heed or ignore it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { MessageSource, UserMessage } from '@deepseek-ai/dsh-llm'
import { ulid } from 'ulid'
import { computeStepEfficiency, computeDifficulty, extractLessonText, inferTaskPattern, computeOutcomeScore } from './types/index.js'
import { ExperienceStore } from './store/experience-store.js'
import type { TurnOutcome, CorrectionEvent } from './types/index.js'
import { detectCorrectionEvents, toCorrectionSignal, extractCorrectionIntentRuleBased } from './correction-detector.js'
import { getPreferencesFilePath, readPreferences, extractPreference, appendPreference, distillPreferencesWithLLM } from './preference-extractor.js'
import { tryLLMComplete, llmMergeLessons, extractCorrectionIntent } from './llm-bridge.js'
import { buildLessonPrompt, generateStructuredReflection, mergeLessonsRuleBased } from './reflection.js'
import { selectModel, guardTool } from './adaptive-strategy.js'
import {
  EFFECTIVE_FACT_SCORE_THRESHOLD,
  FAILED_FACT_SCORE_THRESHOLD,
  INJECTION_BEST_THRESHOLD,
  INJECTION_WORST_THRESHOLD,
  POSITIVE_OUTCOME_THRESHOLD,
  TASK_RESTATED_SIMILARITY_THRESHOLD,
  MIN_WORD_LEN,
  LOW_VALUE_TOOL_MAX,
} from './types/constants.js'

export const name = 'self-improving'

// Cordis inject: wait for these services to be ready before applying.
// - 'tools' for the tools/result event
// - 'systemPrompt' for the section() registration
// - 'agents' for the agent/pre-step and agent/turn-stopping events
export const inject = ['tools', 'systemPrompt']

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface Config {
  dbPath: string
  metaCognitionEnabled: boolean
  behaviorAdapterEnabled: boolean
  minInjectionScore: number
  // Lesson injection budget (characters)
  maxInjectionChars: number
  // Meta-cognition reflection queue cap
  maxPendingReflections: number
  // Experience store generational GC limits
  youngGenMax: number
  oldGenMax: number
  // Lesson merge threshold (unmerged lessons count)
  lessonMergeThreshold: number
  // Experience TTL (days)
  experienceTtlDays: number
  // Active forgetting thresholds
  forgetScoreThreshold: number
  forgetConfidenceThreshold: number
  // Phase 6: adaptive strategy
  adaptiveModelEnabled: boolean
  strongModel: string
  standardModel: string
  adaptiveToolGuardEnabled: boolean
  failedToolDenyThreshold: number
}

export function rulesSchema() {
  return {
    title: 'dsh-self-improving',
    type: 'object',
    properties: {
      dbPath: { type: 'string', default: ':memory:' },
      metaCognitionEnabled: { type: 'boolean', default: true },
      behaviorAdapterEnabled: { type: 'boolean', default: true },
      minInjectionScore: { type: 'number', default: 0.3 },
      maxInjectionChars: { type: 'number', default: 8000 },
      maxPendingReflections: { type: 'number', default: 100 },
      youngGenMax: { type: 'number', default: 200 },
      oldGenMax: { type: 'number', default: 800 },
      lessonMergeThreshold: { type: 'number', default: 20 },
      experienceTtlDays: { type: 'number', default: 30 },
      forgetScoreThreshold: { type: 'number', default: 0.3 },
      forgetConfidenceThreshold: { type: 'number', default: 0.2 },
      // Phase 6: adaptive strategy (all opt-in; defaults keep behavior unchanged)
      adaptiveModelEnabled: { type: 'boolean', default: false },
      strongModel: { type: 'string', default: '' },
      standardModel: { type: 'string', default: '' },
      adaptiveToolGuardEnabled: { type: 'boolean', default: false },
      failedToolDenyThreshold: { type: 'number', default: 3 },
    },
  }
}


// ---------------------------------------------------------------------------
// Plugin apply — wires everything to dsh's real event hooks
// ---------------------------------------------------------------------------

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'self-improving' }

/** Simple stderr logger — works in headless and web mode, visible on console */
function log(msg: string, data?: unknown): void {
  if (data !== undefined) {
    process.stderr.write(`[self-improving] ${msg} ${JSON.stringify(data)}\n`)
  } else {
    process.stderr.write(`[self-improving] ${msg}\n`)
  }
}

/**
 * Extract plain text from a dsh message content field.
 *
 * dsh's `UserMessage.content` is a `ContentBlock[]` (not a plain string), and
 * there is no `text` field on the message. This normalizes both shapes:
 * - string → returned verbatim
 * - array → join the `text`-typed parts (string items or `{type:'text',text}`)
 * - anything else → empty string
 */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => typeof p === 'string' || (p?.type === 'text' && typeof p.text === 'string'))
      .map((p: any) => (typeof p === 'string' ? p : p.text))
      .join(' ')
  }
  return ''
}

/**
 * Find the plain text of the first user-originated message in a given turn.
 *
 * dsh's `user/message` session event carries `data: UserMessage` with NO `turn`
 * field — the turn number lives on the `turn/start` / `turn/end` boundary events.
 * This locates the turn's boundary by `turn/start` seq and returns the first
 * genuine user message (`source.kind === 'user'`) after it, skipping synthetic
 * plugin-injected context (file notices, AGENTS.md, skill content, …).
 *
 * @param events - the agent's session event list (`agent.session.events`).
 * @param turn - the turn number to look up.
 * @returns the extracted text, or '' when no user message is found.
 */
export function findUserMessageText(events: any[], turn: number): string {
  // Locate the turn's start boundary.
  const startIdx = events.findIndex((e) => e.type === 'turn/start' && e.data?.turn === turn)
  if (startIdx === -1) return ''

  // Scan forward until the next turn/start (or end) for a real user message.
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'turn/start' && e.data?.turn !== turn && i !== startIdx) break
    if (e.type === 'turn/end' && e.data?.turn === turn) break
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      return extractMessageText(e.data?.content)
    }
  }
  return ''
}

/**
 * Count genuine user-originated messages within a turn (source.kind === 'user'),
 * excluding synthetic plugin-injected context.
 */
export function countUserMessagesInTurn(events: any[], turn: number): number {
  const startIdx = events.findIndex((e) => e.type === 'turn/start' && e.data?.turn === turn)
  if (startIdx === -1) return 0

  let count = 0
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'turn/start' && e.data?.turn !== turn && i !== startIdx) break
    if (e.type === 'turn/end' && e.data?.turn === turn) break
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') count++
  }
  return count
}

export function apply(ctx: Context, config: Config): void {
  const store = new ExperienceStore(config.dbPath, {
    youngGenMax: config.youngGenMax,
    oldGenMax: config.oldGenMax,
    lessonMergeThreshold: config.lessonMergeThreshold,
    experienceTtlDays: config.experienceTtlDays,
    forgetScoreThreshold: config.forgetScoreThreshold,
    forgetConfidenceThreshold: config.forgetConfidenceThreshold,
  })

  log('plugin loaded', { dbPath: config.dbPath, metaCognition: config.metaCognitionEnabled, behaviorAdapter: config.behaviorAdapterEnabled })

  // Per-agent turn tracking: collect tool results during a turn
  // Key: agent.id only (accumulate all tools across steps within a turn)
  // Also tracks step count for efficiency calculation (P0)
  // P-C: taskUnitId tracks cross-turn aggregation for goal-driven tasks
  const agentTools = new Map<string, {
    tools: { name: string; success: boolean }[]
    sessionId: string
    stepCount: number
    injectedThisTurn: boolean  // P0: track if already injected this turn
    taskUnitId: string        // P-C: ULID grouping turns into a task unit
    goalId: string | null     // P-C: dsh goal id if goal-driven
    lastInjectedIds: string[] // J7: ids of experiences injected in the last turn
  }>()

  // P-C: Track active task unit per agent (for cross-turn aggregation)
  // When a goal exists, all turns until goal complete share the same taskUnitId.
  // When no goal, each turn is its own task unit (default).
  const agentTaskUnits = new Map<string, { taskUnitId: string; goalId: string | null; turns: number }>()

  // --- Layer 1: Observe tool outcomes via tools/result ---
  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const agent = exec.agent
    if (!agent) return

    if (!agentTools.has(agent.id)) {
      // P-C: Resolve or create task unit for this agent
      let taskUnit = agentTaskUnits.get(agent.id)
      if (!taskUnit) {
        // Check if there's an active goal
        let goalId: string | null = null
        try {
          const goalService = ctx.get('goals')
          if (goalService && typeof goalService.get === 'function') {
            const goal = goalService.get(agent)
            if (goal && (goal.phase === 'active')) {
              goalId = goal.id
            }
          }
        } catch { /* goal service not available */ }

        taskUnit = { taskUnitId: ulid(), goalId, turns: 0 }
        agentTaskUnits.set(agent.id, taskUnit)
      }

      agentTools.set(agent.id, {
        tools: [], sessionId: agent.id, stepCount: 0, injectedThisTurn: false,
        taskUnitId: taskUnit.taskUnitId, goalId: taskUnit.goalId,
        lastInjectedIds: [],
      })
    }
    agentTools.get(agent.id)!.tools.push({
      name: exec.name,
      success: !result.isError,
    })

    log(`tool/result — ${exec.name} ${result.isError ? 'FAIL' : 'OK'}`)
  })

  // --- Layer 1 + 4: On turn-stopping, score the turn and store it ---
  ctx.on('agent/turn-stopping', async (payload: { agent: Agent; turn: number; signal: AbortSignal }) => {
    log(`agent/turn-stopping fired — turn=${payload.turn}`)
    const { agent, turn } = payload
    const entry = agentTools.get(agent.id)

    if (!entry || entry.tools.length === 0) {
      log(`turn-stopping: no tools tracked for agent ${agent.id}, skipping (P-B: no-tool turns not stored)`)
      return
    }

    // P-B: Low-value filtering — skip pure Q&A turns (1-2 steps, all success, no failures)
    // These are simple lookups or chitchat that don't produce reusable experience
    const stepCountForFilter = Math.max(entry.stepCount, 1)
    const hasFailuresForFilter = entry.tools.some(t => !t.success)
    const difficultyForFilter = computeDifficulty(stepCountForFilter, hasFailuresForFilter)
    if (difficultyForFilter === 'low' && entry.tools.length <= LOW_VALUE_TOOL_MAX) {
      log(`turn-stopping: low-value turn (P-B: ${entry.tools.length} tools, ${stepCountForFilter} steps, difficulty=low), skipping storage`)
      agentTools.delete(agent.id)
      // M4: Also clean up task unit for no-goal turns to prevent map leak
      if (!entry.goalId) {
        agentTaskUnits.delete(agent.id)
      }
      return
    }

    // Score the turn
    const toolCallCount = entry.tools.length
    const successCount = entry.tools.filter(t => t.success).length
    const toolSuccessRate = toolCallCount > 0 ? successCount / toolCallCount : 0

    // P0: Step count — number of distinct steps in this turn
    // We track it via the pre-step injection (each pre-step = one step)
    const stepCount = Math.max(entry.stepCount, 1)

    // P0: Step efficiency
    const stepEfficiency = computeStepEfficiency(stepCount)

    // P0: Difficulty
    const hasFailures = entry.tools.some(t => !t.success)
    const difficulty = computeDifficulty(stepCount, hasFailures)

    // --- Goal progress: read from dsh goal service ---
    // P1: Prioritize ctx.get('goals') for web mode
    let goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none' = 'none'
    const goalService = ctx.get('goals')
    if (goalService && typeof goalService.get === 'function') {
      try {
        const goal = goalService.get(agent)
        if (goal) {
          if (goal.phase === 'complete') goalProgress = 'advanced'
          else if (goal.phase === 'blocked') goalProgress = 'stalled'
          else if (goal.phase === 'active') goalProgress = 'advanced'
          else if (goal.phase === 'paused') goalProgress = 'none'  // P2: paused ≠ stalled (user may switch tasks)
        }
      } catch { /* goal service may not be available */ }
    }
    // Fallback if no goal service or no goal: use turn/end reason from session events
    if (goalProgress === 'none') {
      try {
        const events = agent.session.events ?? []
        const turnEndEvents = events.filter((e: any) => e.type === 'turn/end' && e.data?.turn === turn)
        const lastTurnEnd = turnEndEvents[turnEndEvents.length - 1]
        if (lastTurnEnd) {
          const reason = lastTurnEnd.data?.reason
          if (reason?.kind === 'completed') goalProgress = 'advanced'
          else if (reason?.kind === 'error') goalProgress = 'regressed'
          else if (reason?.kind === 'max-tokens') goalProgress = 'stalled'
          else if (reason?.kind === 'blocked') goalProgress = 'stalled'
          else if (reason?.kind === 'aborted') goalProgress = 'stalled'  // P1: aborted = negative
          else goalProgress = 'advanced' // unknown → assume advanced
        } else {
          goalProgress = toolSuccessRate >= 0.5 ? 'advanced' : 'stalled'
        }
      } catch {
        goalProgress = toolSuccessRate >= 0.5 ? 'advanced' : 'stalled'
      }
    }

    // --- Guard triggers: scan session events for repeat-tool-reminder injections ---
    let guardCount = 0
    try {
      const events = agent.session.events ?? []
      guardCount = events.filter((e: any) =>
        e.type === 'user/message' &&
        e.data?.source?.plugin === 'repeat-tool-reminder',
      ).length
    } catch { /* session events not available */ }

    // P1: Implicit negative feedback detection
    // Check for: user abort, user correction (step > 1 with user message after agent reply)
    // D3: Also check for user restating the task (high text similarity to previous turn's user message)
    let implicitNegative = false
    try {
      const events = agent.session.events ?? []
      // Check if turn ended due to abort
      const turnEndEvents = events.filter((e: any) => e.type === 'turn/end' && e.data?.turn === turn)
      const lastTurnEnd = turnEndEvents[turnEndEvents.length - 1]
      if (lastTurnEnd?.data?.reason?.kind === 'aborted') {
        implicitNegative = true
      }
      // Check for user correction: >1 genuine user message in the same turn
      // (the first is the task; a later one means the user corrected/steered).
      if (stepCount > 1) {
        const userMsgCount = countUserMessagesInTurn(events, turn)
        if (userMsgCount > 1) {
          implicitNegative = true
        }
      }
      // D3: Check for user restating the task — high similarity to previous turn's first user message
      if (!implicitNegative && turn > 1) {
        const curText = findUserMessageText(events, turn)
        const prevText = findUserMessageText(events, turn - 1)
        if (curText && prevText) {
          // Simple word-overlap similarity (no LLM needed, deterministic)
          const curWords = new Set(curText.toLowerCase().split(/\s+/).filter((w: string) => w.length > MIN_WORD_LEN))
          const prevWords = new Set(prevText.toLowerCase().split(/\s+/).filter((w: string) => w.length > MIN_WORD_LEN))
          if (curWords.size > 0 && prevWords.size > 0) {
            let overlap = 0
            for (const w of curWords) {
              if (prevWords.has(w)) overlap++
            }
            const similarity = overlap / Math.min(curWords.size, prevWords.size)
            // > threshold word overlap → user is likely restating the same task
            if (similarity > TASK_RESTATED_SIMILARITY_THRESHOLD) {
              implicitNegative = true
            }
          }
        }
      }
    } catch { /* ignore */ }

    // --- Correction events（重构计划：以「用户纠正」为黄金信号）---
    // 检测层：四分类（revert/redo/correction/interrupt）+ 节点定位 → 入库 →
    // 汇总成 correctionSignal 喂给评分层（替换粗粒度 implicitNegative 的纠正维度）。
    // redo 的正面价值通过 contrast lesson（见 lesson 提炼）学习，这里只做轻度扣分。
    let correctionEvents: CorrectionEvent[] = []
    try {
      const events = agent.session.events ?? []
      correctionEvents = detectCorrectionEvents(events, turn, entry.tools, agent.id)
      if (correctionEvents.length > 0) {
        store.storeCorrectionEvents(agent.id, `turn-${turn}`, correctionEvents)
        log(`turn ${turn}: detected ${correctionEvents.length} correction event(s) [${correctionEvents.map(e => e.type).join(',')}]`)
      }
    } catch (err) {
      log(`correction detection error: ${(err as Error).message}`)
    }
    const correctionSignal = toCorrectionSignal(correctionEvents)

    // --- User feedback: combine explicit + implicit (P1) ---
    let userFeedback: 'positive' | 'negative' | 'none' = 'none'
    const feedbackService = ctx.get('messageFeedback')
    if (feedbackService && typeof feedbackService.list === 'function') {
      try {
        const result = await feedbackService.list({ sessionId: agent.session.id })
        const items = (result as any)?.value?.items ?? (result as any)?.items ?? []
        if (Array.isArray(items) && items.length > 0) {
          const turnAssistantSeqs = new Set<number>()
          const events = agent.session.events ?? []
          for (const e of events) {
            if (e.type === 'assistant/message' && (e as any).data?.turn === turn) {
              turnAssistantSeqs.add((e as any).seq)
            }
          }
          const turnFeedback = items.filter((item: any) =>
            turnAssistantSeqs.has((item as any).messageSeq) ||
            turnAssistantSeqs.has((item as any).messageId),
          )
          if (turnFeedback.length > 0) {
            const hasNegative = turnFeedback.some((f: any) => f.rating === 'negative')
            const hasPositive = turnFeedback.some((f: any) => f.rating === 'positive')
            userFeedback = hasNegative ? 'negative' : (hasPositive ? 'positive' : 'none')
          }
        }
      } catch { /* feedback service may not be available */ }
    }
    // P1: Apply implicit negative if no explicit feedback
    if (userFeedback === 'none' && implicitNegative) {
      userFeedback = 'negative'
    }

    // P0+P1: Compute outcome score via the shared formula (I7: single source of truth)
    const outcomeScore = computeOutcomeScore({
      goalProgress,
      toolSuccessRate,
      stepEfficiency,
      guardTriggerCount: guardCount,
      userFeedback,
      correctionSignal,
    })

    // Store the experience
    const toolsUsed = entry.tools.map(t => t.name)
    const actions = JSON.stringify({
      tools: entry.tools,
      goalProgress,
      feedback: userFeedback,
      stepCount,
      difficulty,
      stepEfficiency,
      implicitNegative,
      // 纠正事件摘要——供 lesson 提炼层（reflection）读取「用户拒绝/期望」上下文
      corrections: correctionEvents.map(e => ({ type: e.type, text: e.userText })),
    })
    const wsDigest = agent.options.cwd ? String(agent.options.cwd).slice(-32) : null

    // P5: Infer task pattern from first user message
    let taskPattern: string | null = null
    try {
      const events = agent.session.events ?? []
      // dsh user/message events carry data: UserMessage (no `turn`/`text` field);
      // use the turn boundary helper to get the real user prompt text.
      const msgText = findUserMessageText(events, turn)
      if (msgText) {
        taskPattern = inferTaskPattern(msgText)
      }

      // A1-a: Extract explicit preference from user message
      if (msgText) {
        const pref = extractPreference(String(msgText))
        if (pref) {
          const prefPath = getPreferencesFilePath(
            (config as any).dshHome || undefined,
          )
          const added = appendPreference(prefPath, pref)
          if (added) {
            log(`A1-a: preference extracted and saved: "${pref}"`)
          }
        }
      }
    } catch { /* ignore */ }

    const outcome: TurnOutcome = {
      turnId: `turn-${turn}`,
      sessionId: agent.id,
      goalProgress,
      toolCallCount,
      toolSuccessRate,
      guardTriggerCount: guardCount,
      userFeedback,
      stepEfficiency,
      difficulty,
      outcomeScore,
      timestamp: Date.now(),
    }

    // I5: Determine source based on feedback signal quality.
    // 纠正事件是比 implicitNegative 更强的用户拒绝信号——任一纠正即视为 tool-derived。
    const expSource = userFeedback === 'positive' ? 'user-confirmed'
      : (correctionEvents.length > 0 || implicitNegative) ? 'tool-derived'
      : 'model-inferred'

    const expId = store.store(outcome, {
      taskPattern,
      toolsUsed,
      workspaceDigest: wsDigest,
      actions,
      taskUnitId: entry.taskUnitId,
      goalId: entry.goalId,
      source: expSource,
    })

    log(`turn ${turn} scored — score=${outcomeScore.toFixed(2)} | goal=${goalProgress} tools=${toolCallCount} successRate=${toolSuccessRate.toFixed(2)} steps=${stepCount} efficiency=${stepEfficiency.toFixed(2)} difficulty=${difficulty} task=${taskPattern ?? 'unknown'} guards=${guardCount} feedback=${userFeedback} implicitNeg=${implicitNegative} corrections=${correctionEvents.length} | exp ${expId}`)

    // I4: Extract atomic facts from this turn and write to atomic_facts table
    try {
      const subject = `workspace:${wsDigest ?? 'default'}`
      if (outcomeScore >= EFFECTIVE_FACT_SCORE_THRESHOLD && toolsUsed.length > 0) {
        // T4: multi-valued fact — each distinct sequence is its own fact
        store.upsertToolSequenceFact(subject, 'effective-tool-sequence', toolsUsed.join(' → '), 'tool-derived')
      }
      if (outcomeScore <= FAILED_FACT_SCORE_THRESHOLD && toolsUsed.length > 0) {
        store.upsertToolSequenceFact(subject, 'failed-tool-sequence', toolsUsed.join(' → '), 'tool-derived')
      }
      if (taskPattern) {
        // task-type is single-valued per workspace — upsertFact is correct here
        store.upsertFact(subject, 'task-type', taskPattern, 'model-inferred')
      }
    } catch (err) {
      log(`atomic fact extraction error: ${(err as Error).message}`)
    }

    // P2: Synchronously generate lesson (don't wait for maintenance)
    if (config.metaCognitionEnabled) {
      // Drop oldest if queue is full (maintenance delayed, e.g. headless mode)
      if (pendingReflections.length >= maxPendingReflections) {
        pendingReflections.shift()
        log('pending reflections queue full, dropped oldest entry')
      }
      pendingReflections.push({
        expId,
        actions,
        outcomeScore,
        userFeedback,
        toolsUsed,
        stepCount,
        difficulty,
        // 纠正事件文本摘要——lesson 提炼层的「用户拒绝/期望」上下文
        correction: correctionEvents
          .map(e => `[${e.type}] ${e.userText}`)
          .join(' | ') || null,
        injectedIds: entry.lastInjectedIds, // J7: pass injected ids for precise boost
      })

      // W1: Trigger reflection asynchronously (fire-and-forget) — dsh has no
      // `agent/run-maintenance` event, so process the queue right after the
      // turn. Not awaited to avoid blocking turn close.
      void runMaintenance(agent).catch((err) => {
        log(`runMaintenance error: ${(err as Error).message}`)
      })
    }

    // Clean up agent tool tracking for next turn
    agentTools.delete(agent.id)

    // P-C: Close task unit when goal completed, or when there's no goal (per-turn task)
    if (entry.goalId) {
      if (goalProgress === 'advanced') {
        agentTaskUnits.delete(agent.id)
        log(`task unit ${entry.taskUnitId} closed (goal ${entry.goalId} advanced)`)
      }
    } else {
      // K2: No goal → per-turn task unit, clean up immediately
      agentTaskUnits.delete(agent.id)
    }
  })

  // --- Layer 2: Inject experience at agent/pre-step ---
  // P0: Only inject on the first step of each turn, skip subsequent steps
  if (config.behaviorAdapterEnabled) {
    ctx.on('agent/pre-step', async (
      payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
      next: () => Promise<any>,
    ) => {
      const { agent, turn, step } = payload

      // P0: Track step count for this turn
      if (agentTools.has(agent.id)) {
        const entry = agentTools.get(agent.id)!
        entry.stepCount = Math.max(entry.stepCount, step)
      } else {
        // J1: Resolve task unit same as tools/result handler
        let taskUnit = agentTaskUnits.get(agent.id)
        if (!taskUnit) {
          let goalId: string | null = null
          try {
            const goalService = ctx.get('goals')
            if (goalService && typeof goalService.get === 'function') {
              const goal = goalService.get(agent)
              if (goal && goal.phase === 'active') {
                goalId = goal.id
              }
            }
          } catch { /* goal service not available */ }
          taskUnit = { taskUnitId: ulid(), goalId, turns: 0 }
          agentTaskUnits.set(agent.id, taskUnit)
        }
        agentTools.set(agent.id, {
          tools: [], sessionId: agent.id, stepCount: step, injectedThisTurn: false,
          taskUnitId: taskUnit.taskUnitId, goalId: taskUnit.goalId,
          lastInjectedIds: [],
        })
      }

      // P0: Only inject once per turn (first step)
      const entry = agentTools.get(agent.id)!
      if (entry.injectedThisTurn || step > 1) {
        log(`agent/pre-step — turn=${turn} step=${step} (skipping injection, already injected this turn)`)
        return next()
      }

      log(`agent/pre-step — turn=${turn} step=${step} (injecting)`)

      // Query experience store for similar past turns
      const wsDigest = agent.options.cwd ? String(agent.options.cwd).slice(-32) : undefined

        // P5: Infer task pattern from current messages for better retrieval
        const firstMsg = payload.messages?.[0]
        // O8: Handle ContentPart[] — extract text from array items instead of String() on array
        let msgText = ''
        if (firstMsg && typeof firstMsg === 'object') {
          const raw = (firstMsg as any).content ?? (firstMsg as any).text ?? ''
          if (typeof raw === 'string') {
            msgText = raw
          } else if (Array.isArray(raw)) {
            // ContentPart[] — extract text parts
            msgText = raw
              .filter((p: any) => typeof p === 'string' || (p?.type === 'text' && typeof p.text === 'string'))
              .map((p: any) => typeof p === 'string' ? p : p.text)
              .join(' ')
          }
        }
        const currentTaskPattern = msgText ? inferTaskPattern(msgText) : null

        // I3/K3/K4: Sanitize searchText for FTS5 — extract keywords, strip special chars
        const rawSearchText = msgText ? msgText.slice(0, 200) : ''
        const searchText = rawSearchText
          ? rawSearchText
              .replace(/[`~!@#$%^&*()=+\[\]{}|;:'",.<>/?\\]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 100)
          : undefined
        const records = store.query({
          workspaceDigest: wsDigest,
          limit: 10,
          minScore: config.minInjectionScore,
          taskPattern: currentTaskPattern ?? undefined,
          searchText,
        })

        // Always call next() first (waterfall contract: never short-circuit)
        // O2: next() called outside try — catch block returns decision instead of calling next() again
        const decision = await next()

        try {
          if (records.length > 0) {
          // P5: Sort by task pattern match, difficulty priority, then outcome score
          const sorted = [...records].sort((a, b) => {
            if (currentTaskPattern) {
              const aMatch = a.taskPattern === currentTaskPattern ? 1 : 0
              const bMatch = b.taskPattern === currentTaskPattern ? 1 : 0
              if (bMatch !== aMatch) return bMatch - aMatch
            }
            const diffPriority = (d: string) => d === 'high' ? 3 : d === 'medium' ? 2 : 1
            const dp = diffPriority(b.difficulty) - diffPriority(a.difficulty)
            return dp !== 0 ? dp : b.outcomeScore - a.outcomeScore
          })
          // R1: best by sorted order (highest priority), worst by pure outcomeScore (lowest)
          const best = sorted[0]
          const worstByScore = [...records].sort((a, b) => a.outcomeScore - b.outcomeScore)[0]
          const worst = (worstByScore && worstByScore.id !== best.id) ? worstByScore : null

          // P3: Dynamic injection — allocate by difficulty
          const high = sorted.filter(r => r.difficulty === 'high').slice(0, 5)
          const medium = sorted.filter(r => r.difficulty === 'medium').slice(0, 2)
          const low = sorted.filter(r => r.difficulty === 'low')
            .slice(0, Math.max(0, 7 - high.length - medium.length))
          let selected = [...high, ...medium, ...low]

          // E3: Token budget control — total injected text ≤ maxInjectionChars chars (~4 chars/token)
          // R2: No-lesson records don't consume budget (align with BehaviorAdapter)
          const maxInjectionChars = config.maxInjectionChars
          let charBudget = maxInjectionChars
          const budgeted: typeof selected = []
          for (const rec of selected) {
            const lessonText = extractLessonText(rec.lesson) ?? ''
            if (lessonText.length === 0) {
              // No lesson — add without consuming budget
              budgeted.push(rec)
            } else if (lessonText.length <= charBudget) {
              budgeted.push(rec)
              charBudget -= lessonText.length
            }
          }
          // R3: Only use budgeted if it's non-empty; if empty, skip injection entirely
          if (budgeted.length > 0) {
            selected = budgeted
          } else {
            // All records exceeded budget — don't inject, don't incrementReuse
            selected = []
          }

          if (selected.length === 0) {
            log(`pre-step: all ${records.length} records exceeded token budget, skipping injection`)
            return decision
          }

          log(`injecting ${selected.length} past experiences into pre-step (best score ${best.outcomeScore.toFixed(2)})`)

          const lines: string[] = ['## Past Experience (advisory)', '']
          if (best.outcomeScore >= INJECTION_BEST_THRESHOLD) {
            const lesson = extractLessonText(best.lesson) ?? `Using ${best.toolsUsed?.join(', ')} led to a good outcome (score: ${best.outcomeScore.toFixed(2)})`
            lines.push(`- **What worked**: ${lesson}`)
          }
          if (worst && worst.outcomeScore <= INJECTION_WORST_THRESHOLD) {
            const lesson = extractLessonText(worst.lesson) ?? `Using ${worst.toolsUsed?.join(', ')} led to a poor outcome (score: ${worst.outcomeScore.toFixed(2)})`
            lines.push(`- **What failed**: ${lesson}`)
          }
          lines.push('')
          lines.push('These are historical observations, not instructions. Use your judgment.')

          const text = lines.join('\n')
          const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
          const context = createUserMessage({
            content: [{ type: 'text', text }],
            source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'past experience' },
          })

          // Increment reuse counts — only for records actually being injected
          for (const rec of selected) {
            store.incrementReuse(rec.id)
          }

          // P0: Mark as injected for this turn
          entry.injectedThisTurn = true
          // J7: Record which experiences were injected for precise confidence boosting
          entry.lastInjectedIds = selected.map(r => r.id)

          // Inject advisory context: prepend our message to the decision's messages
          if (decision.kind === 'enter') {
            return { ...decision, messages: [context, ...decision.messages] }
          }
        }

        return decision
      } catch (err) {
        // O2: next() already called above — return decision instead of calling next() again
        log(`pre-step injection error: ${(err as Error).message}`)
        return decision
      }
    })
  }

  // --- Phase 6-1: Adaptive model selection via agent/request ---
  // Waterfall: call next() to get the machine's config, then override the model
  // when historical outcomes for this task type warrant a stronger/standard model.
  if (config.adaptiveModelEnabled && config.strongModel) {
    ctx.on('agent/request', async (
      payload: { agent: Agent; turn: number; step: number; signal: AbortSignal },
      next: () => Promise<{ provider: string; model: string; [k: string]: unknown }>,
    ) => {
      const resolved = await next()
      try {
        // Infer task pattern from the agent's session (best-effort, same as turn-stopping)
        let taskPattern: string | null = null
        try {
          const events = payload.agent.session.events ?? []
          const msgText = findUserMessageText(events, payload.turn)
          if (msgText) taskPattern = inferTaskPattern(msgText)
        } catch { /* ignore */ }

        const suggestion = selectModel(taskPattern, store, config.strongModel, config.standardModel)
        if (suggestion && suggestion.model !== resolved.model) {
          log(`Phase 6-1: switching model for "${taskPattern ?? 'general'}" → ${suggestion.model} (${suggestion.reason})`)
          return { ...resolved, model: suggestion.model }
        }
      } catch (err) {
        log(`agent/request adaptive model error: ${(err as Error).message}`)
      }
      return resolved
    })
  }

  // --- Phase 6-2: Adaptive tool guard via tools/pre-execute ---
  // Waterfall: call next() first; when the policy denies a tool, return a deny
  // decision instead of delegating the allow result.
  if (config.adaptiveToolGuardEnabled && config.failedToolDenyThreshold > 0) {
    ctx.on('tools/pre-execute', async (
      exec: { name: string; [k: string]: unknown },
      next: () => Promise<{ kind: string; reason?: string }>,
    ) => {
      const resolved = await next()
      try {
        const decision = guardTool(exec.name, store, config.failedToolDenyThreshold)
        if (decision.kind === 'deny') {
          log(`Phase 6-2: denying tool "${exec.name}" (${decision.reason})`)
          return { kind: 'deny', reason: decision.reason }
        }
      } catch (err) {
        log(`tools/pre-execute adaptive guard error: ${(err as Error).message}`)
      }
      return resolved
    })
  }

  // --- Layer 2: Register system prompt section for learned preferences ---
  // A1-c: Reads from ~/.dsh/preferences.md (persisted preferences) + live stats
  if (config.behaviorAdapterEnabled) {
    ctx.systemPrompt.section({
      name: 'self-improving-learned-preferences',
      order: 450,
      text: () => {
        const lines: string[] = []

        // A1: Read persisted user preferences
        const prefPath = getPreferencesFilePath((config as any).dshHome || undefined)
        const prefContent = readPreferences(prefPath)
        if (prefContent) {
          lines.push('## User Preferences (advisory)', '')
          lines.push(prefContent)
          lines.push('')
        }

        // J4: Inject atomic facts (effective/failed tool sequences)
        // Note: text() callback has no agent context, so we can't filter by current workspace.
        // Limit to top 3 effective + top 3 failed to avoid flooding the system prompt.
        // T4: predicate now carries a sequence hash suffix (multi-valued facts), so
        // match by prefix instead of exact equality.
        try {
          const facts = store.queryFacts()
          const effective = facts.filter(f => f.predicate.startsWith('effective-tool-sequence')).slice(0, 3)
          const failed = facts.filter(f => f.predicate.startsWith('failed-tool-sequence')).slice(0, 3)
          if (effective.length > 0 || failed.length > 0) {
            if (lines.length === 0) lines.push('## Workspace Knowledge (advisory)', '')
            for (const f of effective) {
              lines.push(`- Effective tool sequence: ${f.object}`)
            }
            for (const f of failed) {
              lines.push(`- Failed tool sequence: ${f.object}`)
            }
            lines.push('')
          }
        } catch { /* ignore */ }

        // Corrections（重构计划黄金信号）：全局注入「用户不接受的做法」——
        // 让模型在收到任何 task 前就主动规避被纠正/回退/重做的方向。
        try {
          const corr = store.queryCorrectionEvents(5)
          if (corr.length > 0) {
            if (lines.length === 0) lines.push('## Workspace Knowledge (advisory)', '')
            lines.push('- User has rejected/corrected these approaches — do NOT repeat them:')
            for (const c of corr) {
              const tag = c.type === 'revert' ? 'reverted' : c.type === 'redo' ? 'redone' : c.type === 'interrupt' ? 'interrupted' : 'corrected'
              lines.push(`  * ${tag}: ${(c.intent ?? c.userText).slice(0, 120)}`)
            }
            lines.push('')
          }
        } catch { /* ignore */ }

        // Live stats (kept as supplementary signal)
        const stats = store.stats()
        if (stats.total >= 10) {
          if (lines.length === 0) {
            lines.push('## Learned Preferences (advisory)', '')
          }
          if (stats.avgScore > 0.7) {
            lines.push(`- Recent outcomes are strong (avg score ${stats.avgScore.toFixed(2)} over ${stats.total} turns)`)
          }
          if (stats.avgScore < 0.4) {
            lines.push(`- Recent outcomes have low scores (avg ${stats.avgScore.toFixed(2)}) — consider more careful tool selection`)
          }
          if (stats.positiveCount > stats.total * 0.5) {
            lines.push(`- User has given positive feedback on ${stats.positiveCount} of ${stats.total} turns`)
          }
        }

        return lines.length > 0 ? lines.join('\n') : ''
      },
    })
  }

  // --- Layer 4: Meta-cognition reflection queue ---
  interface PendingReflection {
    expId: string
    actions: string
    outcomeScore: number
    userFeedback: string
    toolsUsed: string[]
    stepCount?: number
    difficulty?: 'low' | 'medium' | 'high'
    /** 纠正事件文本摘要：用户拒绝/期望的上下文（重构计划黄金信号）。 */
    correction?: string | null
    injectedIds?: string[] // J7: ids of experiences injected in the turn that produced this reflection
  }
  // Cap the queue to prevent unbounded growth when maintenance is delayed (e.g. headless mode)
  const maxPendingReflections = config.maxPendingReflections
  const pendingReflections: PendingReflection[] = []

  // Process reflections + periodic maintenance.
  // P2: Generates structured lesson JSON with full Reflection data (P4)
  // P2: Also merges fragmented lessons periodically.
  //
  // W1 (fix): dsh has NO `agent/run-maintenance` event — that was an invented
  // event name that never fired, so lesson generation never ran. This is now a
  // plain function invoked from `agent/turn-stopping` (which carries the agent,
  // giving us the provider/model needed for LLM reflection).
  async function runMaintenance(agent: Agent): Promise<void> {
    // W1: provider/model for LLM calls. agent.options may be empty (the real
    // route is resolved per-request); fall back to the session's request header
    // (the last actually-used provider/model), then give up → rule-based.
    let provider = agent.options?.provider
    let model = agent.options?.model
    if (!provider || !model) {
      try {
        const header = (agent.session as any).requestHeader?.()
        provider = provider || header?.config?.provider
        model = model || header?.config?.model
      } catch { /* requestHeader may not be available */ }
    }
    const llmModel = (provider && model) ? { provider, model } : undefined

    // W3: diagnostic — log whether we resolved a provider/model for LLM calls.
    log(`runMaintenance — llmModel=${llmModel ? llmModel.provider + '/' + llmModel.model : 'NONE'} llmService=${ctx.get?.('llm') ? 'present' : 'MISSING'}`)

    if (pendingReflections.length > 0) {
      log(`processing ${pendingReflections.length} pending reflections`)
    }
    while (pendingReflections.length > 0) {
      const entry = pendingReflections.shift()!

      // I2: Try LLM lesson generation first, fall back to rule-based
      let reflection = generateStructuredReflection(entry)
      const llmResponse = await tryLLMComplete(ctx, buildLessonPrompt(entry), llmModel)
      if (llmResponse) {
        try {
          const clean = llmResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
          const parsed = JSON.parse(clean)
          reflection = {
            whatWorked: parsed.whatWorked ?? parsed.what_worked ?? reflection.whatWorked,
            whatFailed: parsed.whatFailed ?? parsed.what_failed ?? reflection.whatFailed,
            whatToTryDifferently: parsed.whatToTryDifferently ?? parsed.what_to_try_differently ?? reflection.whatToTryDifferently,
            reusableLesson: parsed.reusableLesson ?? parsed.reusable_lesson ?? reflection.reusableLesson,
          }
          log(`lesson generated (LLM) — ${reflection.reusableLesson}`)
        } catch {
          log(`lesson generated (rule-based, LLM parse failed) — ${reflection.reusableLesson}`)
        }
      } else {
        log(`lesson generated (rule-based, no LLM) — ${reflection.reusableLesson}`)
      }
      store.updateLesson(entry.expId, reflection)

      // I6/J7: Boost confidence on experiences that were injected in this turn if outcome was positive
      if (entry.outcomeScore >= POSITIVE_OUTCOME_THRESHOLD && entry.injectedIds && entry.injectedIds.length > 0) {
        for (const id of entry.injectedIds) {
          if (id !== entry.expId) {
            store.boostConfidence(id)
          }
        }
        log(`J7: boosted ${entry.injectedIds.length} injected experiences (positive outcome)`)
      }
    }

    // Δ7.1: Correction intent semantic refinement (LLM, fallback rule-based).
    // 在异步 runMaintenance 里补全检测阶段无 provider 上下文无法做的 intent 提炼。
    try {
      const pendingCorrections = store.queryCorrectionEvents(20).filter(e => !e.intent)
      if (pendingCorrections.length > 0) {
        log(`Δ7.1 refining ${pendingCorrections.length} correction intent(s) ${llmModel ? 'via LLM' : 'via rule-based fallback'}`)
        for (const ev of pendingCorrections) {
          let intent: string | null = null
          if (llmModel) intent = await extractCorrectionIntent(ctx, ev.userText, llmModel)
          if (!intent) intent = extractCorrectionIntentRuleBased(ev)
          if (intent) store.updateCorrectionIntent(ev.id, intent)
        }
      }
    } catch (err) {
      log(`Δ7.1 correction intent refinement error: ${(err as Error).message}`)
    }

    // J2: Detect and resolve atomic fact conflicts
    // Evict lower-source-weight facts when same subject+predicate has different objects
    try {
      const conflicts = store.detectFactConflicts()
      if (conflicts.length > 0) {
        log(`J2: detected ${conflicts.length} fact conflicts`)
        for (const conflict of conflicts) {
          // The first item has the highest source weight (sorted by detectFactConflicts)
          // Evict all others
          for (let i = 1; i < conflict.conflicts.length; i++) {
            store.evictFact(conflict.conflicts[i].id)
            log(`J2: evicted fact ${conflict.conflicts[i].id} (${conflict.subject}/${conflict.predicate}=${conflict.conflicts[i].object}) in favor of ${conflict.conflicts[0].object}`)
          }
        }
      }
    } catch (err) {
      log(`fact conflict detection error: ${(err as Error).message}`)
    }

    // C5: Merge fragmented lessons if enough have accumulated
    // Uses LLM if available (via ctx.llm), falls back to rule-based
    try {
      const groups = store.getUnmergedLessonGroups()
      if (groups.length > 0) {
        log(`merging ${groups.length} lesson groups`)
        for (const group of groups) {
          if (group.records.length < 2) continue
          // C5: Try LLM merge first, fall back to rule-based
          const mergedLesson = await llmMergeLessons(ctx, group.records, mergeLessonsRuleBased, llmModel)
          const sourceIds = group.records.map(r => r.id)
          const tools = group.records[0].toolsUsed ?? []
          store.mergeLessons(sourceIds, mergedLesson, group.records[0].difficulty as any, tools)
          log(`merged ${group.records.length} lessons for difficulty=${group.difficulty} tools=${group.toolsKey}`)
        }
      }
    } catch (err) {
      log(`lesson merge error: ${(err as Error).message}`)
    }

    // A1-b: LLM-based automatic preference distillation
    // Runs periodically during maintenance to extract high-confidence preferences
    try {
      const prefPath = getPreferencesFilePath((config as any).dshHome || undefined)
      const newPrefs = await distillPreferencesWithLLM(ctx, store, prefPath, tryLLMComplete, llmModel)
      if (newPrefs > 0) {
        log(`A1-b: distilled ${newPrefs} new auto-preferences`)
      }
    } catch (err) {
      log(`preference distillation error: ${(err as Error).message}`)
    }

    // Distill preferences + log stats
    const stats = store.stats()
    if (stats.total > 0) {
      log(`store stats — total=${stats.total} avgScore=${stats.avgScore.toFixed(2)} positive=${stats.positiveCount} withLessons=${stats.withLessons} youngGen=${stats.youngGenCount} oldGen=${stats.oldGenCount} highDiff=${stats.highDifficultyCount} merged=${stats.mergedCount}`)
    }
  }

  // --- P5: GUI Settings Bridge ---
  // The dsh-self-improving-gui client plugin reads/writes through settingsScope
  // with namespace 'dsh-self-improving-gui'. We bridge requests here.
  // Note: 'settings' is NOT in our inject array (we don't want to hard-depend on it).
  // We try to access it dynamically; if it's not available, the bridge is simply skipped.
  try {
    const settingsService = (ctx as any).get?.('settings')
    if (settingsService && typeof settingsService.register === 'function') {
      const guiScope = settingsService.register('dsh-self-improving-gui', rulesSchema())

      // Push initial stats
      void guiScope.update({ stats: JSON.stringify(store.stats()) })

      // Watch for GUI requests (exportRequest, importData)
      guiScope.watch((next: any) => {
        // Handle export request
        if (next.exportRequest === 'all') {
          const exportData = store.exportAll()
          void guiScope.update({
            exportData: JSON.stringify(exportData),
            exportRequest: null,
          })
          log(`GUI export — sent ${exportData.length} records`)
        }

        // P8: Use else-if — export and import are mutually exclusive operations
        else if (next.importData) {
          try {
            const data = JSON.parse(next.importData)
            const result = store.importExperiences(data)
            void guiScope.update({
              importResult: JSON.stringify(result),
              importData: null,
              stats: JSON.stringify(store.stats()),
            })
            log(`GUI import — imported=${result.imported} skipped=${result.skipped} invalid=${result.invalid}`)
          } catch (e) {
            void guiScope.update({
              importResult: JSON.stringify({ imported: 0, skipped: 0, invalid: -1 }),
              importData: null,
            })
            log(`GUI import error: ${(e as Error).message}`)
          }
        }
      })
      log('GUI settings bridge active')
    }
  } catch {
    // 'settings' service not injected — GUI bridge disabled (headless mode)
  }

  // --- Cleanup ---
  ctx.effect(() => () => {
    // K2: Clean up in-memory maps to prevent memory leak on long-running processes
    agentTools.clear()
    agentTaskUnits.clear()
    store.close()
  })
}
