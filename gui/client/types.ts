/** Experience stats returned by the host plugin's settings API. */
export interface ExperienceStats {
  total: number
  avgScore: number
  positiveCount: number
  negativeCount: number
  withLessons: number
  youngGenCount: number
  oldGenCount: number
  highDifficultyCount: number
  mergedCount: number
}

/** A single exported experience record. */
export interface ExportedExperience {
  id: string
  outcomeScore: number
  toolsUsed: string[] | null
  lesson: string | null
  difficulty: 'low' | 'medium' | 'high'
  taskPattern: string | null
  generation: number
  merged: boolean
  confidence: number
  reuseCount: number
  createdAt: number
  actions: string
}

/** Import result summary. */
export interface ImportResult {
  imported: number
  skipped: number
  invalid: number
}

/** Settings scope snapshot (from ctx.settingsScope.bind()) */
export interface SettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable' | 'idle'
  value?: T
  revision?: number
  writable: boolean
}

/** Minimal settings scope surface returned by bind(). */
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  set(field: string, value: unknown): Promise<void>
  subscribe(listener: () => void): () => void
}

/** Minimal: only the namespace key of a bind spec. */
export interface SettingsScopeSpec<T = unknown> {
  namespace: string
  decode?(value: unknown): T | undefined
}

/** Self-improving settings: stats, exported data, import data. */
export interface SelfImprovingSettings {
  stats?: string        // JSON string of ExperienceStats
  exportData?: string   // JSON string of ExportedExperience[]
  importData?: string   // JSON string of import array
  importResult?: string  // JSON string of ImportResult
}

/** Minimal dsh client ctx surface used by the experiences plugin. */
export interface ClientContext {
  effect(fn: () => void | (() => void), label?: string): void
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  locale: {
    register(ns: string, dict: Record<string, Record<string, string>>): unknown
    bind(ns: string): (key: string) => string
  }
  settingsScope: {
    bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
  }
}
