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
import { computeStepEfficiency, computeDifficulty, extractLessonText, inferTaskPattern } from './types/index.js'
import { ExperienceStore } from './store/experience-store.js'
import type { TurnOutcome } from './types/index.js'
import { getPreferencesFilePath, readPreferences, extractPreference, appendPreference, distillPreferencesWithLLM } from './preference-extractor.js'
import { tryLLMComplete, llmMergeLessons } from './llm-bridge.js'
import { buildLessonPrompt, generateStructuredReflection, mergeLessonsRuleBased } from './reflection.js'

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


export function apply(ctx: Context, config: Config): void {
  const store = new ExperienceStore(config.dbPath)

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
    if (difficultyForFilter === 'low' && entry.tools.length <= 2) {
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
      // Check for user correction: user messages after assistant in same turn
      if (stepCount > 1) {
        const userMsgsInTurn = events.filter((e: any) =>
          e.type === 'user/message' && e.data?.turn === turn &&
          e.data?.source?.plugin !== 'repeat-tool-reminder',
        )
        if (userMsgsInTurn.length > 0) {
          implicitNegative = true
        }
      }
      // D3: Check for user restating the task — high similarity to previous turn's first user message
      if (!implicitNegative && turn > 1) {
        const currentMsgs = events.filter((e: any) =>
          e.type === 'user/message' && e.data?.turn === turn &&
          e.data?.source?.plugin !== 'repeat-tool-reminder',
        )
        const prevMsgs = events.filter((e: any) =>
          e.type === 'user/message' && e.data?.turn === turn - 1 &&
          e.data?.source?.plugin !== 'repeat-tool-reminder',
        )
        if (currentMsgs.length > 0 && prevMsgs.length > 0) {
          const curText = String(currentMsgs[0].data?.text ?? currentMsgs[0].data?.content ?? '')
          const prevText = String(prevMsgs[0].data?.text ?? prevMsgs[0].data?.content ?? '')
          if (curText && prevText) {
            // Simple word-overlap similarity (no LLM needed, deterministic)
            const curWords = new Set(curText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2))
            const prevWords = new Set(prevText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2))
            if (curWords.size > 0 && prevWords.size > 0) {
              let overlap = 0
              for (const w of curWords) {
                if (prevWords.has(w)) overlap++
              }
              const similarity = overlap / Math.min(curWords.size, prevWords.size)
              // >0.7 word overlap → user is likely restating the same task
              if (similarity > 0.7) {
                implicitNegative = true
              }
            }
          }
        }
      }
    } catch { /* ignore */ }

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

    // P0+P1: Compute outcome score with new weights
    // goalProgress: 0.3, toolSuccess: 0.2, stepEfficiency: 0.25, guardPenalty: 0.15, feedback: 0.1
    const goalScore = goalProgress === 'advanced' ? 1.0 : goalProgress === 'stalled' ? 0.3 : goalProgress === 'regressed' ? 0.0 : 0.5
    const guardPenalty = Math.min(guardCount * 0.1, 0.15)
    const feedbackScore = userFeedback === 'positive' ? 1.0 : userFeedback === 'negative' ? 0.0 : 0.6  // P1: neutral = 0.6 (not 0.5)
    const outcomeScore = Math.max(0, Math.min(1,
      goalScore * 0.3 + toolSuccessRate * 0.2 + stepEfficiency * 0.25 + (0.15 - guardPenalty) + feedbackScore * 0.1,
    ))

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
    })
    const wsDigest = agent.options.cwd ? String(agent.options.cwd).slice(-32) : null

    // P5: Infer task pattern from first user message
    let taskPattern: string | null = null
    try {
      const events = agent.session.events ?? []
      const firstUserMsg = events.find((e: any) => e.type === 'user/message' && e.data?.turn === turn)
      // Q1: Handle ContentPart[] — same as O8 fix in pre-step
      let msgText = ''
      const rawContent = firstUserMsg?.data?.text ?? firstUserMsg?.data?.content ?? ''
      if (typeof rawContent === 'string') {
        msgText = rawContent
      } else if (Array.isArray(rawContent)) {
        msgText = rawContent
          .filter((p: any) => typeof p === 'string' || (p?.type === 'text' && typeof p.text === 'string'))
          .map((p: any) => typeof p === 'string' ? p : p.text)
          .join(' ')
      }
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

    // I5: Determine source based on feedback signal quality
    const expSource = userFeedback === 'positive' ? 'user-confirmed'
      : implicitNegative ? 'tool-derived'
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

    log(`turn ${turn} scored — score=${outcomeScore.toFixed(2)} | goal=${goalProgress} tools=${toolCallCount} successRate=${toolSuccessRate.toFixed(2)} steps=${stepCount} efficiency=${stepEfficiency.toFixed(2)} difficulty=${difficulty} task=${taskPattern ?? 'unknown'} guards=${guardCount} feedback=${userFeedback} implicitNeg=${implicitNegative} | exp ${expId}`)

    // I4: Extract atomic facts from this turn and write to atomic_facts table
    try {
      const subject = `workspace:${wsDigest ?? 'default'}`
      if (outcomeScore >= 0.7 && toolsUsed.length > 0) {
        store.upsertFact(subject, 'effective-tool-sequence', toolsUsed.join(' → '), 'tool-derived')
      }
      if (outcomeScore <= 0.3 && toolsUsed.length > 0) {
        store.upsertFact(subject, 'failed-tool-sequence', toolsUsed.join(' → '), 'tool-derived')
      }
      if (taskPattern) {
        store.upsertFact(subject, 'task-type', taskPattern, 'model-inferred')
      }
    } catch (err) {
      log(`atomic fact extraction error: ${(err as Error).message}`)
    }

    // P2: Synchronously generate lesson (don't wait for maintenance)
    if (config.metaCognitionEnabled) {
      // Drop oldest if queue is full (maintenance delayed, e.g. headless mode)
      if (pendingReflections.length >= MAX_PENDING_REFLECTIONS) {
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
        injectedIds: entry.lastInjectedIds, // J7: pass injected ids for precise boost
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

          // E3: Token budget control — total injected text ≤ 8000 chars (~2000 tokens)
          // R2: No-lesson records don't consume budget (align with BehaviorAdapter)
          const MAX_INJECT_CHARS = 8000
          let charBudget = MAX_INJECT_CHARS
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
          if (best.outcomeScore >= 0.6) {
            const lesson = extractLessonText(best.lesson) ?? `Using ${best.toolsUsed?.join(', ')} led to a good outcome (score: ${best.outcomeScore.toFixed(2)})`
            lines.push(`- **What worked**: ${lesson}`)
          }
          if (worst && worst.outcomeScore <= 0.4) {
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
        try {
          const facts = store.queryFacts()
          const effective = facts.filter(f => f.predicate === 'effective-tool-sequence').slice(0, 3)
          const failed = facts.filter(f => f.predicate === 'failed-tool-sequence').slice(0, 3)
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
    injectedIds?: string[] // J7: ids of experiences injected in the turn that produced this reflection
  }
  // Cap the queue to prevent unbounded growth when maintenance is delayed (e.g. headless mode)
  const MAX_PENDING_REFLECTIONS = 100
  const pendingReflections: PendingReflection[] = []

  // Process reflections during maintenance
  // P2: Generates structured lesson JSON with full Reflection data (P4)
  // P2: Also merges fragmented lessons periodically
  ctx.on('agent/run-maintenance', async () => {
    if (pendingReflections.length > 0) {
      log(`processing ${pendingReflections.length} pending reflections`)
    }
    while (pendingReflections.length > 0) {
      const entry = pendingReflections.shift()!

      // I2: Try LLM lesson generation first, fall back to rule-based
      let reflection = generateStructuredReflection(entry)
      const llmResponse = await tryLLMComplete(ctx, buildLessonPrompt(entry))
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
      if (entry.outcomeScore >= 0.7 && entry.injectedIds && entry.injectedIds.length > 0) {
        for (const id of entry.injectedIds) {
          if (id !== entry.expId) {
            store.boostConfidence(id)
          }
        }
        log(`J7: boosted ${entry.injectedIds.length} injected experiences (positive outcome)`)
      }
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
          const mergedLesson = await llmMergeLessons(ctx, group.records, mergeLessonsRuleBased)
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
      const newPrefs = await distillPreferencesWithLLM(ctx, store, prefPath, tryLLMComplete)
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
  })

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
