/**
 * dsh-rule-enforcement — user-editable soft rules injected into the system prompt.
 *
 * One setting: a block of markdown the user edits (via settings.yaml or the
 * WebUI). It's injected into the agent's system prompt as an **advisory**
 * section, so the model may heed or ignore it.
 */

/** Namespace registered on the dsh settings seam. */
export const SETTINGS_NAMESPACE = 'dsh-rule-enforcement'

/** Default soft-rules text shown before the user edits anything. */
export const DEFAULT_RULES = `# Project Rules (advisory)

Edit this block in Settings > dsh-rule-enforcement.
It is injected into the agent's system prompt as guidance the model may heed or ignore.
`

/** The single user-editable setting document. */
export interface RuleSettings {
  rules: string
}

/** Resolution: fill from stored doc, else the default. */
export function resolveSettings(stored: { rules?: unknown } = {}): RuleSettings {
  const rules = typeof stored.rules === 'string' && stored.rules.trim().length
    ? stored.rules
    : DEFAULT_RULES
  return { rules }
}