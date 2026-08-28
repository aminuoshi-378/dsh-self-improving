/**
 * Behavior Adapter — Layer 2 (test fixture)
 *
 * NOTE: This standalone class is used by tests and benchmark only.
 * The runtime plugin (src/index.ts) inlines equivalent logic and
 * imports ExperienceStore directly. This class is kept for unit testing.
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
import { extractLessonText } from '../types/index.js'
import {
  SMALL_STORE_THRESHOLD,
  MEDIUM_STORE_THRESHOLD,
  HIGH_QUALITY_THRESHOLD,
  PREFERENCE_CONFIDENCE_THRESHOLD,
  MIN_TOTAL_FOR_DISTILL,
  POSITIVE_RATE_DISTILL_THRESHOLD,
  NEGATIVE_RATE_DISTILL_THRESHOLD,
  LOW_AVG_SCORE_THRESHOLD,
  HIGH_AVG_SCORE_THRESHOLD,
  INJECTION_BEST_THRESHOLD,
  INJECTION_WORST_THRESHOLD,
} from '../types/constants.js'

export interface BehaviorAdapterOptions {
  /** Maximum characters to inject per turn (4 chars ≈ 1 token). */
  maxInjectionChars?: number
}

const DEFAULT_BEHAVIOR_ADAPTER_OPTIONS: Required<BehaviorAdapterOptions> = {
  maxInjectionChars: 8000,
}

// Injection limit by store size / quality (local to this fixture)
const LIMIT_SMALL_STORE = 10
const LIMIT_MEDIUM_HIGH_QUALITY = 8
const LIMIT_MEDIUM_LOW_QUALITY = 12
const LIMIT_LARGE_HIGH_QUALITY = 8
const LIMIT_LARGE_LOW_QUALITY = 15

// Model suggestion thresholds (local to this fixture)
const SUGGEST_MODEL_MIN_SAMPLES = 5
const SUGGEST_MODEL_STD_THRESHOLD = 0.8   // avg score >= this → standard model
const SUGGEST_MODEL_STRONG_THRESHOLD = 0.5 // avg score < this → stronger model

export class BehaviorAdapter {
  private store: ExperienceStore
  private preferences: Map<string, LearnedPreference> = new Map()
  private injectionCount = 0
  private options: Required<BehaviorAdapterOptions>

  constructor(store: ExperienceStore, options: BehaviorAdapterOptions = {}) {
    this.store = store
    this.options = { ...DEFAULT_BEHAVIOR_ADAPTER_OPTIONS, ...options }
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
  /**
   * Retrieve and format relevant historical experiences for injection
   * at the start of a new step.
   *
   * P3: Dynamic injection control — allocates slots by difficulty:
   *   high: up to 5, medium: up to 2, low: only fills if not enough
   *   Token budget: total injection ≤ ~2000 tokens (~800 chars)
   *
   * Called from the agent/pre-step waterfall.
   * Returns advisory context — the model can heed or ignore it.
   */
  getExperienceSummary(query: ExperienceQuery): ExperienceSummary | null {
    // P3: Dynamic limit based on difficulty allocation
    const dynamicLimit = this.computeDynamicLimit()
    const records = this.store.query({ ...query, limit: dynamicLimit })

    if (records.length === 0) {
      return null
    }

    // P3: Allocate by difficulty: high first, then medium, low as filler
    const { high, medium, low } = this.partitionByDifficulty(records)
    const selected = [
      ...high.slice(0, 5),
      ...medium.slice(0, 2),
      ...low.slice(0, Math.max(0, 7 - high.length - medium.length)),
    ]

    // P3: Token budget control (~maxInjectionChars chars, using 4 chars/token approx)
    const maxInjectionChars = this.options.maxInjectionChars
    let charBudget = maxInjectionChars
    const budgeted: ExperienceRecord[] = []
    for (const rec of selected) {
      const lessonText = extractLessonText(rec.lesson) ?? ''
      if (lessonText.length > 0 && lessonText.length <= charBudget) {
        budgeted.push(rec)
        charBudget -= lessonText.length
      } else if (lessonText.length === 0) {
        budgeted.push(rec)
      }
    }

    if (budgeted.length === 0) {
      return null
    }

    // Extract lessons from highest and lowest scored matching experiences
    const sortedByScore = [...budgeted].sort(
      (a, b) => b.outcomeScore - a.outcomeScore,
    )

    const highest = sortedByScore[0]
    const lowest = sortedByScore[sortedByScore.length - 1]

    // P4: Extract reusable_lesson from structured JSON lesson
    const whatWorked =
      highest && highest.outcomeScore >= INJECTION_BEST_THRESHOLD
        ? extractLessonText(highest.lesson) ?? this.deriveLesson(highest, 'success')
        : null

    const whatFailed =
      lowest && lowest.outcomeScore <= INJECTION_WORST_THRESHOLD
        ? extractLessonText(lowest.lesson) ?? this.deriveLesson(lowest, 'failure')
        : null

    const suggestedApproach = this.aggregateRecommendations(budgeted)

    // Track reuse for confidence decay
    for (const rec of budgeted) {
      this.store.incrementReuse(rec.id)
    }

    this.injectionCount++

    return {
      whatWorked,
      whatFailed,
      suggestedApproach,
      matchingRecords: budgeted.length,
    }
  }

  /**
   * P3/A6: Compute dynamic limit based on store size and quality.
   * - Small store (<50): return all (up to 10) for best signal
   * - Medium store (50-200): tighter limit when avg score high (quality good, fewer needed)
   * - Large store (>200): wider net when avg score low (need more candidates to find value)
   */
  private computeDynamicLimit(): number {
    const stats = this.store.stats()
    if (stats.total < SMALL_STORE_THRESHOLD) return LIMIT_SMALL_STORE
    // A6: When average quality is high, shrink the candidate pool (fewer needed)
    // When quality is low, expand it (more candidates to find something useful)
    if (stats.total < MEDIUM_STORE_THRESHOLD) {
      return stats.avgScore > HIGH_QUALITY_THRESHOLD ? LIMIT_MEDIUM_HIGH_QUALITY : LIMIT_MEDIUM_LOW_QUALITY
    }
    return stats.avgScore > HIGH_QUALITY_THRESHOLD ? LIMIT_LARGE_HIGH_QUALITY : LIMIT_LARGE_LOW_QUALITY
  }

  /**
   * P3: Partition records by difficulty for priority injection.
   */
  private partitionByDifficulty(records: ExperienceRecord[]): {
    high: ExperienceRecord[]
    medium: ExperienceRecord[]
    low: ExperienceRecord[]
  } {
    const high: ExperienceRecord[] = []
    const medium: ExperienceRecord[] = []
    const low: ExperienceRecord[] = []
    for (const rec of records) {
      switch (rec.difficulty) {
        case 'high': high.push(rec); break
        case 'medium': medium.push(rec); break
        case 'low': low.push(rec); break
        default: medium.push(rec); break
      }
    }
    return { high, medium, low }
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
      .filter((p) => p.confidence > PREFERENCE_CONFIDENCE_THRESHOLD)
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

    if (records.length < SUGGEST_MODEL_MIN_SAMPLES) {
      // Not enough data to make a recommendation
      return null
    }

    const avgScore = records.reduce((sum, r) => sum + r.outcomeScore, 0) / records.length

    if (avgScore >= SUGGEST_MODEL_STD_THRESHOLD) {
      return {
        model: 'deepseek-chat',
        reason: `Historical avg score ${avgScore.toFixed(2)} for "${taskPattern}" — standard model sufficient`,
      }
    }

    if (avgScore < SUGGEST_MODEL_STRONG_THRESHOLD) {
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
    if (stats.total < MIN_TOTAL_FOR_DISTILL) return // need minimum data

    const positiveRate = stats.total > 0 ? stats.positiveCount / stats.total : 0
    const negativeRate = stats.total > 0 ? stats.negativeCount / stats.total : 0

    if (positiveRate > POSITIVE_RATE_DISTILL_THRESHOLD) {
      this.registerPreference(
        'feedback-pattern',
        'User tends to give positive feedback — current approach is working well',
        positiveRate,
      )
    }

    if (negativeRate > NEGATIVE_RATE_DISTILL_THRESHOLD) {
      this.registerPreference(
        'feedback-warning',
        'User has been giving negative feedback frequently — consider adjusting approach',
        negativeRate,
      )
    }

    // Distill from average score
    if (stats.avgScore < LOW_AVG_SCORE_THRESHOLD) {
      this.registerPreference(
        'performance-warning',
        'Recent outcomes have low scores — consider more careful tool selection',
        1 - stats.avgScore,
      )
    } else if (stats.avgScore > HIGH_AVG_SCORE_THRESHOLD) {
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
      if (rec.outcomeScore >= INJECTION_BEST_THRESHOLD && rec.toolsUsed) {
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
