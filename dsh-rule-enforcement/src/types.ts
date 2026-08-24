/**
 * Minimal dsh Context types for the dsh-rule-enforcement plugin.
 *
 * Depends on `settings` (for GUI communication) and `systemPrompt` (for injection).
 * Rules are persisted as a plain markdown file, bridged to/from settings.
 */

/** Cordis Context built-in methods/services this plugin uses. */
export interface Context {
  /** Declare service deps and scope their access. */
  inject(services: string[], cb: (ctx: Context) => void): unknown
  /** The settings service (registered via inject). */
  settings: {
    register(ns: string, schema: unknown): {
      get(): { rules?: string }
      update(patch: { rules?: string }): Promise<void>
      watch(cb: (next: { rules?: string }) => void): () => void
    }
  }
  /** The resolving system-prompt access (registered via inject). */
  systemPrompt: {
    section(opts: { name: string; order: number; text: string | (() => string) }): unknown
  }
  /** Cordis effect — returns cleanup on plugin unload. */
  effect(fn: () => (() => void) | void, label?: string): unknown
  /** Optional logger. */
  logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void }
}
