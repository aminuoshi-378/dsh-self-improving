/**
 * A1: User preference extraction and persistence.
 *
 * Extracts explicit preference declarations from user messages
 * and writes them to ~/.dsh/preferences.md with atomic writes.
 * Also provides LLM-based preference distillation.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { ExperienceStore } from './store/experience-store.js'

/** Resolve preferences file path from config or DSH_HOME. */
export function getPreferencesFilePath(dshHome?: string): string {
  const home = dshHome || process.env.DSH_HOME || `${process.env.HOME}/.dsh`
  return join(home, 'preferences.md')
}

/** Read current preferences file content. Returns empty string if file doesn't exist. */
export function readPreferences(filePath: string): string {
  try {
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8').trim()
  } catch {
    return ''
  }
}

const PREFERENCE_TRIGGERS = [
  /(?:请记住|记住|以后总是|我偏好|我喜欢|我习惯于|请确保|务必|remember\s+(?:that\s+)?(?:I|that)\s+(?:prefer|like|always|usually)|from\s+now\s+on)\s*[:：]?\s*(.+)/i,
  /(?:偏好|习惯|要求|规则)\s*[:：]\s*(.+)/i,
]

const PREFERENCE_STOPWORDS = /^(?:帮我|请帮|能不能|可以|帮我修|帮我写|帮我查|帮我找|create|edit|fix|write|read|search|find)\b/i

/** A1-a: Extract explicit preference declarations from user message text. */
export function extractPreference(userText: string): string | null {
  if (!userText || userText.length < 8) return null
  if (PREFERENCE_STOPWORDS.test(userText.trim())) return null

  for (const pattern of PREFERENCE_TRIGGERS) {
    const match = userText.match(pattern)
    if (match && match[1]) {
      const pref = match[1].trim()
      if (pref.length >= 2 && pref.length <= 200) {
        return pref
      }
    }
  }
  return null
}

/** A1-a: Append a preference to the preferences file, with deduplication. */
export function appendPreference(filePath: string, preference: string): boolean {
  const existing = readPreferences(filePath)
  const normalized = preference.toLowerCase().trim()
  if (existing && existing.toLowerCase().includes(normalized)) {
    return false
  }

  const line = `- ${preference}`
  let content: string
  if (!existing) {
    content = `# User Preferences (advisory)\n\n${line}\n`
  } else {
    content = `${existing}\n${line}\n`
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true })
    // J5: Atomic write via temp file + rename
    const tmpPath = `${filePath}.tmp.${process.pid}`
    writeFileSync(tmpPath, content, 'utf-8')
    require('node:fs').renameSync(tmpPath, filePath)
    return true
  } catch {
    return false
  }
}

/**
 * A1-b: LLM-based automatic preference distillation.
 * Analyzes recent lessons and outcome trends to extract high-confidence preferences.
 */
export async function distillPreferencesWithLLM(
  ctx: any,
  store: ExperienceStore,
  prefPath: string,
  tryLLMComplete: (ctx: any, prompt: string) => Promise<string | null>,
): Promise<number> {
  const stats = store.stats()
  if (stats.total < 20) return 0

  const recent = store.query({ limit: 30, minScore: 0.0 })
  const lessons = recent
    .filter(r => r.lesson)
    .map(r => {
      try {
        const parsed = JSON.parse(r.lesson!)
        return {
          lesson: parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson,
          difficulty: r.difficulty,
          score: r.outcomeScore,
          tools: r.toolsUsed,
        }
      } catch { return null }
    })
    .filter(Boolean) as { lesson: string; difficulty: string; score: number; tools: string[] | null }[]

  if (lessons.length < 5) return 0

  const prompt = `You are a preference distillation engine. Analyze the following agent experience lessons and extract high-confidence user preferences or behavioral patterns.

## Experience Data (most recent ${lessons.length} lessons)
${JSON.stringify(lessons.slice(0, 20), null, 2)}

## Stats
- Total experiences: ${stats.total}
- Average score: ${stats.avgScore.toFixed(2)}
- Positive feedback: ${stats.positiveCount}
- Negative feedback: ${stats.negativeCount}
- High difficulty: ${stats.highDifficultyCount}

## Task
Extract 0-3 stable preferences that are strongly supported by the data. Only include preferences with high confidence (e.g., consistently positive/negative outcomes with the same pattern). Do NOT speculate.

## Output Format
Respond with ONLY valid JSON array, no markdown fences:
[{"preference":"concise description of preference","confidence":"high"}]

If no high-confidence preferences can be extracted, return an empty array: []`

  const response = await tryLLMComplete(ctx, prompt)
  if (!response) return 0

  try {
    const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(clean) as { preference: string; confidence: string }[]
    if (!Array.isArray(parsed)) return 0

    const existing = readPreferences(prefPath)
    let added = 0
    for (const item of parsed) {
      if (item.confidence !== 'high' || !item.preference) continue
      const pref = item.preference.trim()
      if (pref.length < 2 || pref.length > 200) continue
      if (existing && existing.toLowerCase().includes(pref.toLowerCase())) continue

      const line = `- [auto] ${pref}`
      let content: string
      if (!existing) {
        content = `# User Preferences (advisory)\n\n## Auto-distilled\n\n${line}\n`
      } else if (existing.includes('## Auto-distilled')) {
        content = existing.replace(/## Auto-distilled\n/, `## Auto-distilled\n${line}\n`)
      } else {
        content = `${existing}\n## Auto-distilled\n\n${line}\n`
      }
      // J5: Atomic write
      const tmpPath = `${prefPath}.tmp.${process.pid}`
      writeFileSync(tmpPath, content, 'utf-8')
      require('node:fs').renameSync(tmpPath, prefPath)
      added++
    }
    return added
  } catch {
    return 0
  }
}
