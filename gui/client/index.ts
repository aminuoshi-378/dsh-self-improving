/**
 * dsh client plugin — Experiences viewer settings tab.
 *
 * Contributes an "Experiences" tab into dsh Web Settings that shows
 * experience library stats and provides import/export buttons.
 * Reads/writes go through `ctx.settingsScope.bind({ namespace })` — the
 * canonical settings transport (NOT ctx.remote).
 *
 * The host plugin (dsh-self-improving) bridges settings <-> SQLite store
 * so the GUI can read stats, export data, and trigger imports.
 */
import type { SelfImprovingSettings, SettingsScope, ClientContext, ImportResult, ExportedExperience, ExperienceStats } from './types.js'
import { ExperiencesPanel, type ExperiencesPanelInjected } from './ExperiencesPanel.js'

/** Locale namespace owned by this plugin. */
export const NS = 'settings.selfImproving'
export const SETTINGS_NS = 'dsh-self-improving-gui'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Contribute the Experiences tab to Web Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    ctx.locale.register(NS, { zh: {}, en: {} })
  }, 'ui-self-improving: dictionaries')

  const scope: SettingsScope<SelfImprovingSettings> = ctx.settingsScope.bind<SelfImprovingSettings>({
    namespace: SETTINGS_NS,
  })

  const readStats = async (): Promise<ExperienceStats | null> => {
    const s = scope.getSnapshot()
    if (s.value?.stats) {
      try { return JSON.parse(s.value.stats) } catch { return null }
    }
    return null
  }

  const exportAll = async (): Promise<ExportedExperience[]> => {
    // Trigger export by setting a flag — the host plugin reads and populates exportData
    await scope.set('exportRequest', 'all')
    // Wait for host to populate exportData (poll snapshot)
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((r) => setTimeout(r, 200))
      const s = scope.getSnapshot()
      if (s.value?.exportData) {
        try { return JSON.parse(s.value.exportData) } catch { return [] }
      }
    }
    return []
  }

  const importExperiences = async (data: ExportedExperience[]): Promise<ImportResult> => {
    // Send import data to host via settings
    await scope.set('importData', JSON.stringify(data))
    // Wait for host to process and populate importResult
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((r) => setTimeout(r, 200))
      const s = scope.getSnapshot()
      if (s.value?.importResult) {
        try { return JSON.parse(s.value.importResult) } catch { return { imported: 0, skipped: 0, invalid: 0 } }
      }
    }
    return { imported: 0, skipped: 0, invalid: data.length }
  }

  const injected = (): ExperiencesPanelInjected => ({
    readStats,
    exportAll,
    importExperiences,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'experiences',
    order: 25,
    label: () => 'Experiences',
    locale: NS,
    inject: injected,
  }, ExperiencesPanel))
}
