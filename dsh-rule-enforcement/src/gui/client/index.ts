/**
 * dsh client plugin — Rules editor settings tab.
 *
 * Contributes a "Rules" tab into dsh Web Settings that edits the single
 * `rules` setting (advisory guidance injected into the system prompt).
 * Reads/writes go through `ctx.settingsScope.bind({ namespace })` — the
 * canonical settings transport (NOT ctx.remote).
 */
import type { RuleSettings, SettingsScope, ClientContext } from './types.js'
import { RulesPanel, type RulesPanelInjected } from './RulesPanel.js'

/** Locale namespace owned by this plugin. */
export const NS = 'settings.ruleEnforcement'
export const SETTINGS_NS = 'dsh-rule-enforcement'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Contribute the Rule Editor tab to Web Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    ctx.locale.register(NS, { zh: {}, en: {} })
  }, 'ui-rule-enforcement: dictionaries')

  const scope: SettingsScope<RuleSettings> = ctx.settingsScope.bind<RuleSettings>({
    namespace: SETTINGS_NS,
  })

  const read = async (): Promise<RuleSettings> => {
    const s = scope.getSnapshot()
    return { rules: s.value?.rules ?? '' }
  }

  const save = async (rules: string): Promise<void> => {
    await scope.set('rules', rules)
  }

  const injected = (): RulesPanelInjected => ({
    read,
    save,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'rules',
    order: 20,
    label: () => 'Rules',
    locale: NS,
    inject: injected,
  }, RulesPanel))
}