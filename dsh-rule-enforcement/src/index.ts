/**
 * dsh-rule-enforcement — plugin entry.
 *
 * Stores rules as a plain markdown file (`~/.dsh/rules.md`) and injects
 * the content into the agent's system prompt as an advisory section.
 *
 * The file is watched for changes — external edits (vim, git pull, etc.)
 * take effect live without restart.
 *
 * The WebUI GUI reads/writes through dsh's settingsScope (remote transport);
 * this plugin bridges settings <-> md file so both stay in sync.
 */

import { getRulesFilePath, readRules, writeRules, watchRules } from './rules-file.js'
import z from 'schemastery'

/** Services this entry requires. */
export const inject = ['settings', 'systemPrompt']

/** Settings namespace (used by the GUI to read/write via settingsScope). */
const SETTINGS_NAMESPACE = 'dsh-rule-enforcement'

/**
 * Schemastery schema for the { rules: string } setting.
 * Must be a callable function (schemastery returns one), not a plain object.
 */
function rulesSchema() {
  return z.object({
    rules: z.string().default(''),
  })
}

interface SettingsScope {
  get(): { rules?: string }
  update(patch: { rules?: string }): Promise<void>
  watch(cb: (next: { rules?: string }) => void): () => void
}

interface SystemPromptService {
  section(opts: { name: string; order: number; text: string | (() => string) }): unknown
  context(opts: { name: string; order: number; text: string | (() => string) }): unknown
}

interface SettingsService {
  register(ns: string, schema: unknown): SettingsScope
}

/** Minimal ctx shape — dsh provides the real Context at runtime. */
interface PluginContext {
  settings: SettingsService
  systemPrompt: SystemPromptService
  effect(fn: () => (() => void) | void, label?: string): unknown
  logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void }
}

/**
 * Cordis plugin factory.
 */
export function apply(ctx: PluginContext, config: Record<string, unknown> = {}): void {
  // Resolve file path: config.filePath or ~/.dsh/rules.md
  const dshHome = (config.dshHome as string) || process.env.DSH_HOME || `${process.env.HOME}/.dsh`
  const filePath = (config.filePath as string) || getRulesFilePath(dshHome)

  ctx.logger?.info?.(`dsh-rule-enforcement: rules file at ${filePath}`)

  // 1. Read rules from the md file (or create it with defaults)
  const fileContent = readRules(filePath)
  let currentRules = fileContent

  // 2. Register settings namespace + push initial value for GUI
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, rulesSchema())
  void scope.update({ rules: fileContent })

  // 3. Inject rules into the system prompt as a section.
  //    This is a persistent directive the model must follow — not advisory.
  //    The text provider re-reads currentRules on every prompt assembly,
  //    so file edits apply live without restart.
  //    Order 200: after persona (order 0), before tool descriptions.
  ctx.systemPrompt.section({
    name: 'rules',
    order: 200,
    text: () => currentRules,
  })

  // 4. Settings → File: when GUI writes, persist to md file
  scope.watch((next: { rules?: string }) => {
    const newRules = typeof next.rules === 'string' && next.rules.trim().length
      ? next.rules
      : currentRules
    if (newRules !== currentRules) {
      currentRules = newRules
      writeRules(filePath, newRules)
      ctx.logger?.info?.('dsh-rule-enforcement: rules updated via WebUI, saved to file')
    }
  })

  // 5. File → Settings: when md file changes externally, sync back
  const stopWatch = watchRules(filePath, (content) => {
    if (content !== currentRules) {
      currentRules = content
      void scope.update({ rules: content })
      ctx.logger?.info?.('dsh-rule-enforcement: rules file changed externally, live reload')
    }
  })

  // 6. Cleanup on plugin unload
  ctx.effect(() => () => {
    stopWatch()
  })
}

export const name = 'dsh-rule-enforcement'
