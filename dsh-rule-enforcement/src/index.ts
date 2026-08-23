/**
 * dsh-rule-enforcement — plugin entry.
 *
 * Registers a single user-editable "soft rules" setting and injects it into
 * the agent's system prompt as an advisory section. Changes take effect live
 * (no restart) via the settings `watch`.
 *
 * Cordis contract: service access goes through `inject` (declared by the
 * module-level `export const inject`), never a runtime `ctx.x` probe.
 */
import type { Context } from './types.js'
import {
  SETTINGS_NAMESPACE,
  resolveSettings,
  type RuleSettings,
} from './settings.js'

/** Services this entry requires. */
export const inject = ['settings', 'systemPrompt'] as const

/**
 * A small schemastery-compatible schema for the { rules: string } setting.
 * (Plain shape; dsh's settings provider resolves the namespace from it.)
 */
function rulesSchema(): unknown {
  return {
    title: 'dsh-rule-enforcement',
    type: 'object',
    properties: { rules: { type: 'string' } },
    required: ['rules'],
  }
}

/**
 * Cordis plugin factory. Reads the rules setting and keeps a system-prompt
 * section in sync with it.
 */
export function apply(ctx: Context, _config: Record<string, unknown> = {}): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, rulesSchema())
    // Initial value.
    let current: RuleSettings = resolveSettings(scope.get())

    ctx.inject(['systemPrompt'], (promptCtx) => {
      // text is a provider: re-read on every prompt assembly, so edits apply
      // without re-registering.
      promptCtx.systemPrompt.section({
        name: 'rules',
        order: 100,
        text: () => current.rules,
      })
    })

    // Live update: any settings change refreshes the injected text.
    scope.watch((next: { rules?: string }) => {
      current = resolveSettings(next)
      ctx.logger?.info?.('dsh-rule-enforcement: rules updated')
    })
  })
}

export const name = 'dsh-rule-enforcement'