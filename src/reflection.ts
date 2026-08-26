/**
 * Reflection generation — structured lesson from turn data.
 *
 * I2: LLM prompt builder for lesson generation.
 * P2: Rule-based fallback reflection and lesson merging.
 */

import type { ExperienceRecord } from './types/index.js'

/** I2: Build LLM prompt for lesson generation from turn data. */
export function buildLessonPrompt(entry: {
  actions: string
  outcomeScore: number
  userFeedback: string
  toolsUsed: string[]
  stepCount?: number
  difficulty?: 'low' | 'medium' | 'high'
}): string {
  let parsedActions: any = {}
  try { parsedActions = JSON.parse(entry.actions) } catch {}
  const toolNames = parsedActions.tools?.map((t: any) => t.tool).filter(Boolean) ?? entry.toolsUsed
  const failedTools = parsedActions.tools?.filter((t: any) => !t.ok).map((t: any) => t.tool) ?? []

  return `You are a reflection engine. Analyze this agent turn and produce a structured lesson.

## Turn Data
- Tools used: ${toolNames.join(' → ')}
- Failed tools: ${failedTools.join(', ') || 'none'}
- Steps: ${entry.stepCount ?? 'unknown'}
- Difficulty: ${entry.difficulty ?? 'medium'}
- Outcome score: ${entry.outcomeScore.toFixed(2)}
- User feedback: ${entry.userFeedback}

## Task
Produce a concise, actionable lesson from this turn. Focus on what specifically worked or failed, not generic advice.

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
}): {
  whatWorked: string
  whatFailed: string
  whatToTryDifferently: string
  reusableLesson: string
} {
  let parsedActions: any = {}
  try { parsedActions = JSON.parse(entry.actions) } catch {}

  const toolNames = parsedActions.tools?.map((t: any) => t.tool).filter(Boolean) ?? entry.toolsUsed
  const guardCount = parsedActions.guards?.length ?? 0
  const stepInfo = entry.stepCount ? ` in ${entry.stepCount} steps` : ''
  const diffInfo = entry.difficulty ? ` (difficulty: ${entry.difficulty})` : ''

  let whatWorked: string
  let whatFailed: string
  let whatToTryDifferently: string
  let reusableLesson: string

  if (entry.outcomeScore >= 0.8) {
    whatWorked = `Tool sequence [${toolNames.join(' → ')}]${stepInfo}${diffInfo} achieved a strong outcome (score: ${entry.outcomeScore.toFixed(2)})`
    whatFailed = 'No significant failures detected'
    whatToTryDifferently = 'Continue using this approach for similar tasks'
    reusableLesson = `For ${entry.difficulty ?? 'medium'} tasks, [${toolNames.join(' → ')}] is effective${stepInfo}`
  } else if (entry.outcomeScore <= 0.3) {
    whatWorked = 'No clearly successful elements identified'
    const failedTools = parsedActions.tools?.filter((t: any) => !t.ok).map((t: any) => t.tool) ?? []
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
