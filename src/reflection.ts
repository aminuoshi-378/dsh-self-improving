/**
 * Reflection generation — structured lesson from turn data.
 *
 * I2: LLM prompt builder for lesson generation.
 * P2: Rule-based fallback reflection and lesson merging.
 */

import type { ExperienceRecord } from './types/index.js'
import {
  REFLECTION_SUCCESS_THRESHOLD,
  REFLECTION_FAILURE_THRESHOLD,
} from './types/constants.js'

/**
 * M1: Normalize a tool entry from the actions JSON.
 *
 * Two formats exist in the wild:
 *   - Runtime (index.ts):            { name: string, success: boolean }
 *   - OutcomeEvaluator (test class): { tool: string, ok: boolean, ms: number }
 *
 * Both must be handled, otherwise lesson generation silently loses tool names
 * and failed-tool lists (they'd always come back empty).
 */
function normalizeToolEntry(t: any): { name: string; ok: boolean } | null {
  if (!t || typeof t !== 'object') return null
  const name = t.name ?? t.tool
  if (typeof name !== 'string' || name.length === 0) return null
  // `success` (runtime) and `ok` (evaluator) both mean "the call succeeded".
  const ok = t.success ?? t.ok
  return { name, ok: ok !== false }
}

/** M1: Extract tool names and failed tool names from an actions JSON string. */
function extractToolInfo(actions: string, fallbackTools: string[]): {
  toolNames: string[]
  failedTools: string[]
  guardCount: number
} {
  let parsed: any = {}
  try { parsed = JSON.parse(actions) } catch { /* not JSON — use fallback */ }

  const raw = Array.isArray(parsed.tools) ? parsed.tools : []
  const normalized = raw.map(normalizeToolEntry).filter(Boolean) as { name: string; ok: boolean }[]

  return {
    toolNames: normalized.length > 0 ? normalized.map(t => t.name) : fallbackTools,
    failedTools: normalized.filter(t => !t.ok).map(t => t.name),
    guardCount: Array.isArray(parsed.guards) ? parsed.guards.length : 0,
  }
}

/** I2: Build LLM prompt for lesson generation from turn data. */
export function buildLessonPrompt(entry: {
  actions: string
  outcomeScore: number
  userFeedback: string
  toolsUsed: string[]
  stepCount?: number
  difficulty?: 'low' | 'medium' | 'high'
  correction?: string | null
}): string {
  const { toolNames, failedTools } = extractToolInfo(entry.actions, entry.toolsUsed)

  return `You are a reflection engine. Analyze this agent turn and produce a structured lesson.

## Turn Data
- Tools used: ${toolNames.join(' → ')}
- Failed tools: ${failedTools.join(', ') || 'none'}
- Steps: ${entry.stepCount ?? 'unknown'}
- Difficulty: ${entry.difficulty ?? 'medium'}
- Outcome score: ${entry.outcomeScore.toFixed(2)}
- User feedback: ${entry.userFeedback}
${entry.correction ? `- User corrections (golden signal): ${entry.correction}` : ''}

## Task
Produce a concise, actionable lesson from this turn. Focus on what specifically worked or failed, not generic advice.
If the user corrected or rejected an approach, the lesson MUST capture what the user does not accept and the expected alternative — this is the single most important signal.

## Output Format
Respond with ONLY valid JSON, no markdown fences:
{"whatWorked":"specific description","whatFailed":"specific description","whatToTryDifferently":"suggestion","reusableLesson":"concise actionable lesson under 50 words"}`
}

/** P2: Rule-based structured reflection (fallback when no LLM available). */
export function generateStructuredReflection(entry: {
  actions: string
  outcomeScore: number
  userFeedback: string
  toolsUsed: string[]
  stepCount?: number
  difficulty?: 'low' | 'medium' | 'high'
  correction?: string | null
}): {
  whatWorked: string
  whatFailed: string
  whatToTryDifferently: string
  reusableLesson: string
} {
  const { toolNames, failedTools, guardCount } = extractToolInfo(entry.actions, entry.toolsUsed)
  const stepInfo = entry.stepCount ? ` in ${entry.stepCount} steps` : ''
  const diffInfo = entry.difficulty ? ` (difficulty: ${entry.difficulty})` : ''

  // 纠正上下文（黄金信号）：一旦用户纠正/回退/重做，优先沉淀「用户不接受的方案+期望」。
  const correctionCtx = entry.correction?.trim()
  const hasCorrection = !!correctionCtx

  let whatWorked: string
  let whatFailed: string
  let whatToTryDifferently: string
  let reusableLesson: string

  if (correctionCtx) {
    whatWorked = hasCorrection ? 'Approach aligned before the user intervened' : ''
    whatFailed = `User corrected/rejected the approach: ${correctionCtx}`
    whatToTryDifferently = 'Follow the user\'s expected alternative; do not repeat the corrected/rejected approach'
    reusableLesson = `User rejected [${toolNames.join(' → ')}] (${correctionCtx}) — avoid this approach; follow the user's stated alternative`
  } else if (entry.outcomeScore >= REFLECTION_SUCCESS_THRESHOLD) {
    whatWorked = `Tool sequence [${toolNames.join(' → ')}]${stepInfo}${diffInfo} achieved a strong outcome (score: ${entry.outcomeScore.toFixed(2)})`
    whatFailed = 'No significant failures detected'
    whatToTryDifferently = 'Continue using this approach for similar tasks'
    reusableLesson = `For ${entry.difficulty ?? 'medium'} tasks, [${toolNames.join(' → ')}] is effective${stepInfo}`
  } else if (entry.outcomeScore <= REFLECTION_FAILURE_THRESHOLD) {
    whatWorked = 'No clearly successful elements identified'
    whatFailed = failedTools.length > 0
      ? `Tools [${failedTools.join(', ')}] failed${stepInfo}${diffInfo} (score: ${entry.outcomeScore.toFixed(2)})`
      : `Overall outcome was poor (score: ${entry.outcomeScore.toFixed(2)})${diffInfo}`
    whatToTryDifferently = guardCount > 0
      ? 'Avoid repeating the same tool calls — try a different approach'
      : 'Consider breaking the task into smaller steps or using different tools'
    reusableLesson = `When facing ${entry.difficulty ?? 'medium'} tasks similar to this, avoid [${failedTools.join(', ') || toolNames.join(', ')}] — try an alternative approach`
  } else {
    whatWorked = `Partial success with [${toolNames.join(' → ')}]${stepInfo} (score: ${entry.outcomeScore.toFixed(2)})`
    whatFailed = guardCount > 0
      ? `Guard triggers (${guardCount}) suggest inefficiency or looping`
      : 'Mixed results — some tools succeeded, others did not'
    whatToTryDifferently = 'Review tool selection and optimize the sequence'
    reusableLesson = `For ${entry.difficulty ?? 'medium'} tasks, [${toolNames.join(' → ')}] gives mixed results${stepInfo} — consider alternatives for failing steps`
  }

  return { whatWorked, whatFailed, whatToTryDifferently, reusableLesson }
}

/** P2: Rule-based lesson merging (fallback when no LLM available). */
export function mergeLessonsRuleBased(records: ExperienceRecord[]): {
  whatWorked: string
  whatFailed: string
  whatToTryDifferently: string
  reusableLesson: string
} {
  const lessons = records.map(r => {
    try {
      const parsed = JSON.parse(r.lesson ?? '{}')
      return parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson ?? ''
    } catch {
      return r.lesson ?? ''
    }
  }).filter(l => l.length > 0)

  return {
    whatWorked: `Consolidated from ${records.length} experiences`,
    whatFailed: 'See individual records for specific failures',
    whatToTryDifferently: 'Apply the consolidated lesson',
    reusableLesson: lessons.join('; ') || 'No specific lesson extracted',
  }
}
