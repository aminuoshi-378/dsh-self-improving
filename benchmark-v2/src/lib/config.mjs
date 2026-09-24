import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** benchmark-v2 root directory. */
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

export function loadConfig() {
  return JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'))
}
