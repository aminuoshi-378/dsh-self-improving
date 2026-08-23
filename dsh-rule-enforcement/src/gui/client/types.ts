/** The single setting this GUI edits: a block of user-authored rules text. */
export interface RuleSettings {
  rules: string
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

/** Minimal dsh client ctx surface used by the editor plugin. */
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