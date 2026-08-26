/**
 * Meta-Cognition Engine — Layer 4
 *
 * After a turn ends, review the decision path, extract reusable lessons.
 * Writes to Experience Store's `lesson` field.
 *
 * Key constraints:
 *   - Async: triggered via agent.runMaintenance() during idle
 *   - Low-cost model: uses deepseek-chat (not deepseek-reasoner)
 *   - Optional: can be disabled; Layers 1–3 form a closed loop without it
 *
 * Mount point: turn/end session event (durable, fires after turn is closed)
 */

import type { ExperienceStore } from '../store/experience-store.js'
import type { Reflection, ExperienceRecord } from '../types/index.js'

/**
 * LLM client interface — abstracted so the actual LLM call can be mocked
 * in tests and swapped to different providers in production.
 */
export interface LLMClient {
  complete(prompt: string): Promise<string>
}

/**
 * A pending reflection task — queued during turn/end,
 * processed during runMaintenance.
 */
interface PendingReflection {
  experienceId: string
  turnId: string
  sessionId: string
  actions: string
  outcomeScore: number
  userFeedback: string
  toolsUsed?: string[]
  stepCount?: number
  difficulty?: 'low' | 'medium' | 'high'
}

export class MetaCognitionEngine {
  private store: ExperienceStore
  private llm: LLMClient | null
  private queue: PendingReflection[] = []
  private enabled: boolean = true
  private reflectionCount = 0

  constructor(store: ExperienceStore, llm: LLMClient | null = null) {
    this.store = store
    this.llm = llm
  }

  // -------------------------------------------------------------------------
  // Queue management
  // -------------------------------------------------------------------------

  /**
   * Queue a reflection task for a completed turn.
   * Called from the turn/end event handler.
   * Does NOT block — just queues for later processing.
   */
  queueReflection(entry: {
    experienceId: string
    turnId: string
    sessionId: string
    actions: string
    outcomeScore: number
    userFeedback: string
    toolsUsed?: string[]
    stepCount?: number
    difficulty?: 'low' | 'medium' | 'high'
  }): void {
    if (!this.enabled) return

    this.queue.push(entry)
  }

  /**
   * Process all pending reflections.
   * Called from agent.runMaintenance() during idle time.
   *
   * If no LLM client is configured, uses rule-based fallback reflection.
   */
  async processQueue(): Promise<number> {
    if (!this.enabled || this.queue.length === 0) {
      return 0
    }

    let processed = 0

    // Process all pending reflections
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!
      await this.reflect(entry)
      processed++
    }

    return processed
  }

  // -------------------------------------------------------------------------
  // Core reflection logic
  // -------------------------------------------------------------------------

  /**
   * Generate a structured reflection for a single experience.
   * Uses LLM if available, falls back to rule-based reflection.
   */
  private async reflect(entry: PendingReflection): Promise<void> {
    let reflection: Reflection

    if (this.llm) {
      reflection = await this.llmReflect(entry)
    } else {
      reflection = this.ruleBasedReflect(entry)
    }

    // Write the lesson to the Experience Store
    this.store.updateLesson(entry.experienceId, reflection)

    // If this was a positive outcome, boost confidence on similar past experiences
    if (entry.outcomeScore >= 0.7) {
      this.boostSimilarExperiences(entry)
    }

    this.reflectionCount++
  }

  /**
   * LLM-based reflection — uses a low-cost model to generate a structured lesson.
   */
  private async llmReflect(entry: PendingReflection): Promise<Reflection> {
    const prompt = this.buildReflectionPrompt(entry)

    try {
      const response = await this.llm!.complete(prompt)
      return this.parseReflectionResponse(response)
    } catch {
      // Fallback to rule-based if LLM call fails
      return this.ruleBasedReflect(entry)
    }
  }

  /**
   * Rule-based reflection — fallback when no LLM is available or LLM fails.
   * Produces a simpler but still useful lesson.
   */
  ruleBasedReflect(entry: PendingReflection): Reflection {
    const actions = this.parseActions(entry.actions)
    const toolNames: string[] = actions.tools?.map((t: { tool?: string }) => t.tool).filter((t): t is string => typeof t === 'string') ?? []
    const guardCount = actions.guards?.length ?? 0

    const whatWorked = this.deriveWhatWorked(entry, toolNames)
    const whatFailed = this.deriveWhatFailed(entry, toolNames, guardCount)
    const whatToTryDifferently = this.deriveAlternative(entry, guardCount)
    const reusableLesson = this.deriveLesson(entry, whatWorked, whatFailed)

    // Store full Reflection as JSON (P4: structured information)
    return {
      whatWorked,
      whatFailed,
      whatToTryDifferently,
      reusableLesson,
    }
  }

  // -------------------------------------------------------------------------
  // Prompt building and response parsing
  // -------------------------------------------------------------------------

  /**
   * Build the reflection prompt for the LLM.
   * Input: this turn's tool call sequence + results + goal progress + feedback
   * Output: structured JSON with what_worked, what_failed, etc.
   */
  private buildReflectionPrompt(entry: PendingReflection): string {
    const stepInfo = entry.stepCount ? `\n- Steps: ${entry.stepCount}` : ''
    const diffInfo = entry.difficulty ? `\n- Difficulty: ${entry.difficulty}` : ''
    const toolsInfo = entry.toolsUsed && entry.toolsUsed.length > 0
      ? `\n- Tools Used: ${entry.toolsUsed.join(' → ')}`
      : ''

    return `You are a meta-cognition engine. Analyze the following agent turn and produce a structured reflection.

## Turn Data
- Session: ${entry.sessionId}
- Turn: ${entry.turnId}
- Outcome Score: ${entry.outcomeScore.toFixed(2)} (0.0 = poor, 1.0 = excellent)
- User Feedback: ${entry.userFeedback}${stepInfo}${diffInfo}${toolsInfo}
- Actions: ${entry.actions}

## Task
Reflect on this turn's decision path and extract reusable lessons.

Consider:
1. Analyze the SPECIFIC actions in the actions JSON — what individual tool calls succeeded or failed and why
2. What specific tool selection, sequencing, or configuration led to good results?
3. What caused failures or inefficiencies? Be concrete (e.g., "forgot to handle Promise rejection", "missing error check after write")
4. What would you try differently next time in a similar situation?
5. What is the single most actionable, context-specific lesson?

Important: The reusable_lesson must be specific and actionable, not a generic observation like "tool X is good". Include concrete context about WHEN and WHY this pattern matters.

## Output Format
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "what_worked": "concise description of what worked, with specific context",
  "what_failed": "concise description of what failed, with specific context",
  "what_to_try_differently": "concise suggestion for next time",
  "reusable_lesson": "a single actionable, context-specific lesson, under 50 words"
}`
  }

  /**
   * Parse the LLM's JSON response into a Reflection object.
   * Falls back to rule-based reflection if parsing fails.
   */
  private parseReflectionResponse(response: string): Reflection {
    try {
      // Strip any markdown code fences if present
      const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(cleaned)

      return {
        whatWorked: parsed.what_worked ?? '',
        whatFailed: parsed.what_failed ?? '',
        whatToTryDifferently: parsed.what_to_try_differently ?? '',
        reusableLesson: parsed.reusable_lesson ?? '',
      }
    } catch {
      // If parsing fails, return an empty-ish reflection
      // The caller should have a fallback
      return {
        whatWorked: '',
        whatFailed: 'Reflection parsing failed',
        whatToTryDifferently: '',
        reusableLesson: 'Reflection could not be parsed — see raw turn data',
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rule-based derivation helpers
  // -------------------------------------------------------------------------

  private parseActions(actionsJson: string): {
    tools?: { tool: string; ok: boolean; ms: number }[]
    guards?: { guard: string; reason: string }[]
    goalProgress?: string
    feedback?: string
  } {
    try {
      return JSON.parse(actionsJson)
    } catch {
      return {}
    }
  }

  private deriveWhatWorked(
    entry: PendingReflection,
    toolNames: string[],
  ): string {
    if (entry.outcomeScore >= 0.7) {
      if (toolNames.length > 0) {
        const stepInfo = entry.stepCount ? ` in ${entry.stepCount} steps` : ''
        return `Tool sequence [${toolNames.join(' → ')}]${stepInfo} achieved a good outcome (score: ${entry.outcomeScore.toFixed(2)})`
      }
      return `Turn achieved a good outcome (score: ${entry.outcomeScore.toFixed(2)})`
    }
    if (entry.userFeedback === 'positive') {
      return 'User provided positive feedback, indicating the approach was acceptable'
    }
    return 'No clearly successful elements identified in this turn'
  }

  private deriveWhatFailed(
    entry: PendingReflection,
    toolNames: string[],
    guardCount: number,
  ): string {
    if (entry.outcomeScore < 0.4) {
      const toolInfo = toolNames.length > 0 ? ` using [${toolNames.join(', ')}]` : ''
      return `Overall outcome was poor (score: ${entry.outcomeScore.toFixed(2)})${toolInfo} — tool selection or execution may have been suboptimal`
    }
    if (guardCount > 0) {
      return `Guard triggers (${guardCount}) suggest the agent may have been stuck in a loop`
    }
    if (entry.userFeedback === 'negative') {
      return 'User provided negative feedback'
    }
    return 'No clearly failed elements identified'
  }

  private deriveAlternative(
    entry: PendingReflection,
    guardCount: number,
  ): string {
    if (guardCount > 0) {
      return 'Avoid repeating the same tool calls — try a different approach or tool combination'
    }
    if (entry.outcomeScore < 0.4) {
      return 'Consider breaking the task into smaller steps or using different tools'
    }
    return 'No specific alternative needed — current approach was adequate'
  }

  private deriveLesson(
    entry: PendingReflection,
    whatWorked: string,
    whatFailed: string,
  ): string {
    if (entry.outcomeScore >= 0.8) {
      return `High-quality outcome: ${whatWorked.toLowerCase()}`
    }
    if (entry.outcomeScore <= 0.3) {
      return `Poor outcome: ${whatFailed.toLowerCase()} — try a different approach next time`
    }
    return `Mixed outcome (score: ${entry.outcomeScore.toFixed(2)}): ${whatWorked.toLowerCase()}, but ${whatFailed.toLowerCase()}`
  }

  // -------------------------------------------------------------------------
  // P2: Lesson merging
  // -------------------------------------------------------------------------

  /**
   * P2: Merge fragmented lessons periodically.
   * Called after processing reflections if enough unmerged lessons have accumulated.
   * Uses LLM if available to summarize common patterns.
   */
  async mergeLessonsIfNeeded(): Promise<number> {
    const groups = this.store.getUnmergedLessonGroups()
    if (groups.length === 0) return 0

    let merged = 0
    for (const group of groups) {
      if (group.records.length < 2) continue

      let mergedLesson: Reflection

      if (this.llm) {
        try {
          mergedLesson = await this.llmMergeLessons(group.records)
        } catch {
          mergedLesson = this.ruleBasedMergeLessons(group.records)
        }
      } else {
        mergedLesson = this.ruleBasedMergeLessons(group.records)
      }

      const sourceIds = group.records.map((r) => r.id)
      const tools = group.records[0].toolsUsed ?? []
      this.store.mergeLessons(sourceIds, mergedLesson, group.records[0].difficulty, tools)
      merged++
    }

    return merged
  }

  private async llmMergeLessons(records: ExperienceRecord[]): Promise<Reflection> {
    const lessons = records.map((r) => {
      try { return JSON.parse(r.lesson ?? '{}') } catch { return { reusable_lesson: r.lesson ?? '' } }
    })

    const prompt = `You are a lesson consolidation engine. Merge these related lessons into a single consolidated lesson.

## Input Lessons
${JSON.stringify(lessons, null, 2)}

## Task
Find the common pattern across these lessons and produce a single, more general but still actionable lesson.

## Output Format
Respond with ONLY valid JSON:
{
  "what_worked": "merged description of what worked",
  "what_failed": "merged description of what failed",
  "what_to_try_differently": "merged suggestion",
  "reusable_lesson": "a single consolidated, actionable lesson, under 50 words"
}`

    const response = await this.llm!.complete(prompt)
    return this.parseReflectionResponse(response)
  }

  private ruleBasedMergeLessons(records: ExperienceRecord[]): Reflection {
    const lessons = records.map((r) => {
      try {
        const parsed = JSON.parse(r.lesson ?? '{}')
        return parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson ?? ''
      } catch {
        return r.lesson ?? ''
      }
    })

    return {
      whatWorked: `Consolidated from ${records.length} experiences`,
      whatFailed: 'See individual records for specific failures',
      whatToTryDifferently: 'Apply the consolidated lesson',
      reusableLesson: lessons.filter((l) => l.length > 0).join('; ') || 'No specific lesson extracted',
    }
  }

  // -------------------------------------------------------------------------
  // Confidence boosting
  // -------------------------------------------------------------------------

  /**
   * When a new positive outcome confirms a past lesson, boost that lesson's confidence.
   */
  private boostSimilarExperiences(entry: PendingReflection): void {
    const records = this.store.query({
      limit: 5,
      minScore: 0.6,
    })

    for (const rec of records) {
      if (rec.id !== entry.experienceId) {
        this.store.boostConfidence(rec.id)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Getters and configuration
  // -------------------------------------------------------------------------

  getPendingCount(): number {
    return this.queue.length
  }

  getReflectionCount(): number {
    return this.reflectionCount
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.queue = []
    }
  }

  /**
   * Get a recent experience record for reflection.
   * Used by the engine to find records that need lessons.
   */
  getRecordsNeedingReflection(limit: number = 10): ExperienceRecord[] {
    // Query recent records that don't have a lesson yet
    const all = this.store.query({ limit: limit * 5 })
    return all.filter((r) => r.lesson === null).slice(0, limit)
  }
}
