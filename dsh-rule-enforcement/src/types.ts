/**
 * Minimal dsh Context types for the dsh-rule-enforcement plugin.
 *
 * dsh provides real services (`settings`, `systemPrompt`, `logger`) at runtime;
 * we model only the surface this plugin touches. `inject`/`on`/`plugin`/`logger`
 * are Cordis Context built-ins (not services) and are accessed directly.
 */

/** Cordis Context built-in methods/services this plugin uses. */
export interface Context {
  /** Declare service deps and scope their access. */
  inject(services: string[], cb: (ctx: Context) => void): unknown
  /** The settings service (registered via inject). */
  settings: {
    register(ns: string, schema: unknown): {
      get(): { rules?: string }
      watch(cb: (next: { rules?: string }) => void): () => void
    }
  }
  /** The resolving system-prompt access (registered via inject). */
  systemPrompt: {
    section(opts: { name: string; order: number; text: string | (() => string) }): unknown
  }
  logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void }
}