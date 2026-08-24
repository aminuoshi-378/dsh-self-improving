/**
 * dsh-rule-enforcement — rules file read/write.
 *
 * The rules are stored as a plain markdown file at `~/.dsh/rules.md`.
 * This module handles reading, writing, and watching that file.
 * The file content is injected into the agent's system prompt as advisory.
 */

import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** Default file path for the rules markdown. */
export function getRulesFilePath(dshHome: string): string {
  return join(dshHome, 'rules.md')
}

/** Default rules content written when the file doesn't exist yet. */
export const DEFAULT_RULES = `# Project Rules

Edit this file at ~/.dsh/rules.md — or via the WebUI Settings → Rules tab.
Content here is injected into the agent's system prompt as mandatory rules
the model must follow.

## Examples

- Reply in Chinese when the user writes in Chinese
- Update CHANGELOG before committing
- Use TypeScript for all new files
`

/**
 * Read the rules file. If it doesn't exist, create it with defaults.
 * Returns the file content as a string.
 */
export function readRules(filePath: string): string {
  try {
    if (!existsSync(filePath)) {
      // Ensure parent dir exists
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, DEFAULT_RULES, 'utf-8')
      return DEFAULT_RULES
    }
    const content = readFileSync(filePath, 'utf-8')
    return content.trim().length > 0 ? content : DEFAULT_RULES
  } catch {
    return DEFAULT_RULES
  }
}

/**
 * Write rules content to the file.
 */
export function writeRules(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

/**
 * Watch the rules file for changes. Returns a stop function.
 * The callback is called on every file change.
 */
export function watchRules(filePath: string, callback: (content: string) => void): () => void {
  let stopped = false
  try {
    watchFile(filePath, { interval: 500 }, () => {
      if (stopped) return
      const content = readRules(filePath)
      callback(content)
    })
  } catch {
    // If watching fails, silently degrade — the initial read still works
  }
  return () => {
    stopped = true
    try {
      unwatchFile(filePath)
    } catch {
      // noop
    }
  }
}
