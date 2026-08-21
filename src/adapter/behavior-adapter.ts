/**
 * Behavior Adapter — Layer 2
 *
 * Reads Experience Store, injects learned experience at the start of
 * new sessions / new steps. All injection is ADVISORY (context the model
 * can heed or ignore), never a forced config mutation.
 *
 * Mount points (existing dsh extension points):
 *   agent/pre-step (waterfall)       → historical experience summary
 *   system-prompt/assemble            → learned behavioral preferences
 *   agent/request (waterfall)         → model/parameter selection
 */

import type { ExperienceStore } from '../store/experience-store.js'
import type {
  ExperienceRecord,
  ExperienceQuery,
  ExperienceSummary,
  LearnedPreference,
} from '../types/index.js'

export class BehaviorAdapter {
  private store: ExperienceStore
  private preferences: Map<string, LearnedPreference> = new Map()
  private injectionCount = 0

  constructor(store: ExperienceStore) {
    this.store = store
  }

  // -------------------------------------------------------------------------
  // agent/pre-step injection
  // -------------------------------------------------------------------------

  /**
   * Retrieve and format relevant historical experiences for injection
   * at the start of a new step.
   *
   * Called from the agent/pre-step waterfall.
   * Returns advisory context — the model can heed or ignore it.
   */
  getExperienceSummary(query: ExperienceQuery): ExperienceSummary | null {
    const records = this.store.query(query)

    if (records.length === 0) {
      return null
    }

    // Extract lessons from highest and lowest scored matching experiences
    const sortedByScore = [...records].sort(
      (a, b) => b.outcomeScore - a.outcomeScore,
    )

    const highest = sortedByScore[0]
    const lowest = sortedByScore[sortedByScore.length - 1]

    const whatWorked =
      highest && highest.outcomeScore >= 0.6
        ? highest.lesson ?? this.deriveLesson(highest, 'success')
        : null

    const whatFailed =
      lowest && lowest.outcomeScore <= 0.4
        ? lowest.lesson ?? this.deriveLesson(lowest, 'failure')
        : null

    const suggestedApproach = this.aggregateRecommendations(records)

    // Track reuse for confidence decay
    for (const rec of records) {
      this.store.incrementReuse(rec.id)
    }

    this.injectionCount++

    return {
      whatWorked,
      whatFailed,
      suggestedApproach,
      matchingRecords: records.length,
    }
  }

  /**
   * Format the experience summary as markdown for injection into agent context.
   */
  formatExperienceMarkdown(summary: ExperienceSummary): string {
    const lines: string[] = [
      '## Past Experience (advisory)',
      '',
      `Based on ${summary.matchingRecords} similar past experience(s):`,
      '',
    ]

    if (summary.whatWorked) {
      lines.push(`- **What worked**: ${summary.whatWorked}`)
    }
    if (summary.whatFailed) {
      lines.push(`- **What failed**: ${summary.whatFailed}`)
    }
    if (summary.suggestedApproach) {
      lines.push(`- **Suggested approach**: ${summary.suggestedApproach}`)
    }

    lines.push('')
    lines.push(
      'These are historical observations, not instructions. Use your judgment.',
    )

    return lines.join('\n')
  }

  // -------------------------------------------------------------------------
  // system-prompt/assemble injection
  // -------------------------------------------------------------------------

  /**
   * Retrieve learned behavioral preferences for system prompt injection.
   * Returns a dynamically assembled section ordered after static sections
   * but before tool schemas.
   */
  getLearnedPreferences(): LearnedPreference[] {
    // Sort by confidence descending
    return Array.from(this.preferences.values())
      .filter((p) => p.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Format learned preferences as markdown for system prompt section.
   */
  formatPreferencesMarkdown(): string {
    const prefs = this.getLearnedPreferences()

    if (prefs.length === 0) {
      return ''
    }

    const lines: string[] = ['## Learned Preferences (advisory)', '']

    for (const pref of prefs) {
      lines.push(`- ${pref.value}`)
    }

    return lines.join('\n')
  }

  /**
   * Register or update a learned preference.
   * Called when the system distills a preference from accumulated feedback.
   */
  registerPreference(key: string, value: string, confidence: number): void {
    this.preferences.set(key, { key, value, confidence })
  }

  // -------------------------------------------------------------------------
  // agent/request — model/parameter selection
  // -------------------------------------------------------------------------

  /**
   * Suggest a model based on historical success rates for the current task type.
   * Returns null if no recommendation (use default).
   *
   * This is advisory — the agent/request waterfall can use this to adjust
   * LLM config, but the final decision is the model's.
   */
  suggestModel(taskPattern: string): { model: string; reason: string } | null {
    const records = this.store.query({
      taskPattern,
      limit: 50,
      minScore: 0.0,
    })

    if (records.length < 5) {
      // Not enough data to make a recommendation
      return null
    }

    const avgScore = records.reduce((sum, r) => sum + r.outcomeScore, 0) / records.length

    if (avgScore >= 0.8) {
      return {
        model: 'deepseek-chat',
        reason: `Historical avg score ${avgScore.toFixed(2)} for "${taskPattern}" — standard model sufficient`,
      }
    }

    if (avgScore < 0.5) {
      return {
        model: 'deepseek-reasoner',
        reason: `Historical avg score ${avgScore.toFixed(2)} for "${taskPattern}" — stronger reasoning model recommended`,
      }
    }

    return null
  }

  // -------------------------------------------------------------------------
  // Preference distillation
  // -------------------------------------------------------------------------

  /**
   * Distill preferences from accumulated experience data.
   * This is a rule-based extraction, not LLM-based.
   * Called periodically (e.g., during runMaintenance).
   */
  distillPreferences(): void {
    const stats = this.store.stats()

    // Distill from feedback patterns
    if (stats.total < 10) return // need minimum data

    const positiveRate = stats.total > 0 ? stats.positiveCount / stats.total : 0
    const negativeRate = stats.total > 0 ? stats.negativeCount / stats.total : 0

    if (positiveRate > 0.7) {
      this.registerPreference(
        'feedback-pattern',
        'User tends to give positive feedback — current approach is working well',
        positiveRate,
      )
    }

    if (negativeRate > 0.3) {
      this.registerPreference(
        'feedback-warning',
        'User has been giving negative feedback frequently — consider adjusting approach',
        negativeRate,
      )
    }

    // Distill from average score
    if (stats.avgScore < 0.4) {
      this.registerPreference(
        'performance-warning',
        'Recent outcomes have low scores — consider more careful tool selection',
        1 - stats.avgScore,
      )
    } else if (stats.avgScore > 0.8) {
      this.registerPreference(
        'performance-positive',
        'Recent outcomes have high scores — current approach is effective',
        stats.avgScore,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  getInjectionCount(): number {
    return this.injectionCount
  }

  getPreferenceCount(): number {
    return this.preferences.size
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Derive a lesson from an experience record when no LLM-generated lesson exists.
   * Rule-based fallback.
   */
  private deriveLesson(rec: ExperienceRecord, outcome: 'success' | 'failure'): string {
    const tools = rec.toolsUsed ? rec.toolsUsed.join(', ') : 'various tools'

    if (outcome === 'success') {
      return `Using ${tools} in this context led to a successful outcome (score: ${rec.outcomeScore.toFixed(2)})`
    }

    return `Using ${tools} in this context led to a poor outcome (score: ${rec.outcomeScore.toFixed(2)})`
  }

  /**
   * Aggregate recommendations from multiple experience records.
   */
  private aggregateRecommendations(records: ExperienceRecord[]): string | null {
    if (records.length === 0) return null

    // Find the most common successful tool pattern
    const toolFreq = new Map<string, number>()
    for (const rec of records) {
      if (rec.outcomeScore >= 0.6 && rec.toolsUsed) {
        for (const tool of rec.toolsUsed) {
          toolFreq.set(tool, (toolFreq.get(tool) ?? 0) + 1)
        }
      }
    }

    if (toolFreq.size === 0) return null

    const sortedTools = [...toolFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tool]) => tool)

    if (sortedTools.length === 0) return null

    return `Tools that worked well in similar situations: ${sortedTools.join(', ')}`
  }
}
