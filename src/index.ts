/**
 * dsh-self-improving — Plugin Entry Point
 *
 * This is the main plugin that wires together the four-layer learning system:
 *
 *   Layer 1: Outcome Evaluator     — score each turn (agent/turn-stopping, read-only)
 *   Layer 2: Behavior Adapter      — inject experience (agent/pre-step, system-prompt/assemble)
 *   Layer 3: Experience Store      — persistent memory (SQLite)
 *   Layer 4: Meta-Cognition Engine — reflect and extract lessons (turn/end + runMaintenance)
 *
 * All injection is advisory — the model can heed or ignore it.
 * Unload this plugin and the agent returns to fully deterministic behavior.
 *
 * Mount points used (all existing dsh extension points):
 *   agent/turn-stopping (serial)  → Outcome Evaluator
 *   agent/pre-step (waterfall)     → Behavior Adapter (experience injection)
 *   system-prompt/assemble         → Behavior Adapter (learned preferences)
 *   turn/end (durable)             → Meta-Cognition Engine (queue reflection)
 *   agent/runMaintenance           → Meta-Cognition Engine (process queue)
 *
 * The plugin is designed to work in a standalone context (for testing)
 * as well as when mounted into a dsh runtime.
 */

import { ExperienceStore } from './store/experience-store.js'
import { OutcomeEvaluator } from './evaluator/outcome-evaluator.js'
import { BehaviorAdapter } from './adapter/behavior-adapter.js'
import { MetaCognitionEngine } from './meta-cognition/meta-cognition-engine.js'

export { ExperienceStore } from './store/experience-store.js'
export { OutcomeEvaluator } from './evaluator/outcome-evaluator.js'
export { BehaviorAdapter } from './adapter/behavior-adapter.js'
export { MetaCognitionEngine } from './meta-cognition/meta-cognition-engine.js'
export type { LLMClient } from './meta-cognition/meta-cognition-engine.js'

export type {
  TurnOutcome,
  TurnData,
  ToolResultEntry,
  GuardTrigger,
  ExperienceRecord,
  ExperienceQuery,
  ExperienceSummary,
  LearnedPreference,
  Reflection,
} from './types/index.js'

export { SCORE_WEIGHTS } from './types/index.js'

// ---------------------------------------------------------------------------
// Plugin configuration schema
// ---------------------------------------------------------------------------

export interface SelfImprovingConfig {
  /** Path to the SQLite database file. Use ':memory:' for in-memory. */
  dbPath: string
  /** Enable/disable the Meta-Cognition Engine (Layer 4). */
  metaCognitionEnabled: boolean
  /** Enable/disable the Behavior Adapter (Layer 2). */
  behaviorAdapterEnabled: boolean
  /** Maximum number of experience records to retain. */
  maxRecords: number
  /** Minimum outcome score for experiences to be injected. */
  minInjectionScore: number
}

export const defaultConfig: SelfImprovingConfig = {
  dbPath: ':memory:',
  metaCognitionEnabled: true,
  behaviorAdapterEnabled: true,
  maxRecords: 1000,
  minInjectionScore: 0.3,
}

// ---------------------------------------------------------------------------
// dsh Plugin Application
// ---------------------------------------------------------------------------

/**
 * The dsh plugin apply function.
 *
 * In a dsh runtime, this would be called by Cordis when the plugin loads.
 * For standalone use (testing, embedding), the classes can be instantiated directly.
 *
 * Usage in a dsh profile:
 *   cordis.yml:
 *     - id: self-improving
 *       name: dsh-self-improving
 *
 *   cordis.patch.yml:
 *     - insert:
 *         - id: self-improving
 *           name: dsh-self-improving
 *           config:
 *             dbPath: ~/.dsh/experiences.db
 *             metaCognitionEnabled: true
 *
 * NOTE: This function uses optional dsh-specific APIs. When running outside dsh
 * (e.g., in tests), it gracefully degrades to no-op.
 */
export function apply(ctx: any, config: Partial<SelfImprovingConfig> = {}): void {
  const mergedConfig = { ...defaultConfig, ...config }

  // Initialize the four layers
  const store = new ExperienceStore(mergedConfig.dbPath)
  const evaluator = new OutcomeEvaluator(store)
  const adapter = mergedConfig.behaviorAdapterEnabled
    ? new BehaviorAdapter(store)
    : null
  const metaEngine = mergedConfig.metaCognitionEnabled
    ? new MetaCognitionEngine(store, ctx.get?.('llm') ?? null)
    : null

  // --- Layer 1: Outcome Evaluator on agent/turn-stopping ---
  // This is a serial event — our listener observes and records, then lets the
  // turn proceed to closure. We never modify the turn.
  if (ctx.on) {
    ctx.on('agent/turn-stopping', (payload: any) => {
      try {
        evaluator.evaluateAndStore(
          {
            turnId: payload?.turnId ?? 'unknown',
            sessionId: payload?.sessionId ?? 'unknown',
            goalProgress: payload?.goalProgress ?? 'none',
            toolResults: payload?.toolResults ?? [],
            guardTriggers: payload?.guardTriggers ?? [],
            userFeedback: payload?.userFeedback ?? 'none',
            timestamp: Date.now(),
          },
          {
            taskPattern: payload?.taskPattern ?? null,
            toolsUsed: payload?.toolsUsed ?? null,
            workspaceDigest: payload?.workspaceDigest ?? null,
            tags: payload?.tags,
          },
        )
      } catch (err) {
        // The evaluator is read-only and must never break the agent loop.
        // Log and swallow.
        ctx.logger?.warn?.('self-improving: outcome evaluator error', err)
      }
    })
  }

  // --- Layer 2: Behavior Adapter on agent/pre-step ---
  // This is a waterfall — we inject advisory context by calling next().
  if (ctx.on && adapter) {
    ctx.on('agent/pre-step', (payload: any, next: () => void) => {
      try {
        const summary = adapter.getExperienceSummary({
          taskPattern: payload?.taskPattern,
          toolsUsed: payload?.toolsUsed,
          workspaceDigest: payload?.workspaceDigest,
          limit: 5,
          minScore: mergedConfig.minInjectionScore,
        })

        if (summary) {
          const markdown = adapter.formatExperienceMarkdown(summary)
          // Inject as advisory context — the model can heed or ignore it
          if (payload?.inject) {
            payload.inject(markdown)
          } else if (payload?.context) {
            payload.context.push(markdown)
          }
        }
      } catch (err) {
        ctx.logger?.warn?.('self-improving: behavior adapter error', err)
      }

      // CRITICAL: always call next() in waterfall — never short-circuit
      next()
    })
  }

  // --- Layer 2: Behavior Adapter on system-prompt/assemble ---
  if (ctx.systemPrompt && adapter) {
    ctx.systemPrompt.section({
      id: 'self-improving-learned-preferences',
      title: 'Learned Preferences',
      content: () => adapter.formatPreferencesMarkdown(),
      order: 450, // after static sections, before tool schemas
    })
  }

  // --- Layer 4: Meta-Cognition Engine on turn/end ---
  if (ctx.on && metaEngine) {
    ctx.on('turn/end', () => {
      if (!metaEngine.isEnabled()) return

      try {
        // Find the most recent experience record for this turn
        const recentRecords = store.query({ limit: 1 })
        const latest = recentRecords[0]

        if (latest) {
          metaEngine.queueReflection({
            experienceId: latest.id,
            turnId: latest.turnId,
            sessionId: latest.sessionId,
            actions: latest.actions,
            outcomeScore: latest.outcomeScore,
            userFeedback: latest.userFeedback,
          })
        }
      } catch (err) {
        ctx.logger?.warn?.('self-improving: meta-cognition queue error', err)
      }
    })
  }

  // --- Layer 4: Meta-Cognition Engine on runMaintenance ---
  if (ctx.on && metaEngine) {
    ctx.on('agent/run-maintenance', async () => {
      try {
        await metaEngine.processQueue()

        // Also distill preferences periodically
        if (adapter) {
          adapter.distillPreferences()
        }
      } catch (err) {
        ctx.logger?.warn?.('self-improving: maintenance error', err)
      }
    })
  }

  // --- Cleanup on unload ---
  if (ctx.effect) {
    ctx.effect(() => {
      return () => {
        store.close()
      }
    })
  }
}
