/**
 * DSH Runner — 调用 dsh headless 执行单个任务，解析输出
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { InteractionTurn } from './types.js'

const HEADLESS_PATCH = join(process.env.HOME || '', '.dsh/profiles/headless/cordis.patch.yml')

export function parseSelfImprovingLog(stderr: string): {
  toolCalls: number
  score: number | null
  difficulty: string | null
  injected: boolean
} {
  const lines = stderr.split('\n')
  const toolResultLines = lines.filter((l) => l.includes('[self-improving] tool/result'))
  let toolCalls = toolResultLines.length

  const preStepLines = lines.filter((l) => l.includes('[self-improving] agent/pre-step'))
  if (toolCalls === 0 && preStepLines.length > 0) toolCalls = preStepLines.length

  const scoreLine = lines.find((l) => l.includes('[self-improving] turn') && l.includes('scored'))
  let score: number | null = null
  let difficulty: string | null = null
  if (scoreLine) {
    const sm = scoreLine.match(/score=([\d.]+)/); if (sm) score = parseFloat(sm[1])
    const dm = scoreLine.match(/difficulty=(\w+)/); if (dm) difficulty = dm[1]
  }

  const injected = lines.some((l) => l.includes('(injecting)'))
  return { toolCalls, score, difficulty, injected }
}

export function countWorkspace(dir: string): { fileCount: number; totalCodeLines: number } {
  let fileCount = 0, totalCodeLines = 0
  try {
    for (const f of readdirSync(dir)) {
      const fp = join(dir, f)
      if (statSync(fp).isFile() && (f.endsWith('.js') || f.endsWith('.ts'))) {
        fileCount++
        totalCodeLines += readFileSync(fp, 'utf-8').split('\n').length
      }
    }
  } catch {}
  return { fileCount, totalCodeLines }
}

export function runDshTask(
  prompt: string,
  workDir: string,
  timeoutMs = 120_000,
): InteractionTurn {
  const result = spawnSync('dsh', ['--profile', 'headless', prompt], {
    cwd: workDir,
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const exitCode = result.status ?? 1
  const parsed = parseSelfImprovingLog(stderr)

  let toolCalls = parsed.toolCalls
  if (toolCalls === 0) {
    const actions = stdout.match(/```/g)
    toolCalls = actions ? Math.ceil(actions.length / 2) : Math.ceil(stdout.length / 500)
  }

  return {
    prompt,
    intent: '',
    dshOutput: stdout.trim(),
    dshStderr: stderr,
    toolCalls,
    outcomeScore: parsed.score,
    difficulty: parsed.difficulty,
    injected: parsed.injected,
    exitCode,
  }
}

export interface PatchConfig {
  model: string
  provider: string
  enabled: boolean
  dbPath: string
}

export function writePatch(cfg: PatchConfig): void {
  const base = `- id: llm-deepseek
  disabled: true
- id: agent-default-model
  config:
    provider: ${cfg.provider}
    model: ${cfg.model}
- id: system-prompt
  config:
    persona: "You are a coding agent. Your working directory is the current directory. Write code, fix bugs, and run tests."`

  if (cfg.enabled) {
    const { writeFileSync } = require('node:fs')
    writeFileSync(HEADLESS_PATCH, base + `
- insert:
    - id: self-improving
      name: 'dsh-self-improving'
      config:
        dbPath: '${cfg.dbPath}'
        metaCognitionEnabled: true
        behaviorAdapterEnabled: true
        minInjectionScore: 0.3
`)
  } else {
    const { writeFileSync } = require('node:fs')
    writeFileSync(HEADLESS_PATCH, base + '\n')
  }
}

export function savePatch(): string {
  if (existsSync(HEADLESS_PATCH)) {
    return readFileSync(HEADLESS_PATCH, 'utf-8')
  }
  return ''
}

export function restorePatch(original: string): void {
  const { writeFileSync } = require('node:fs')
  writeFileSync(HEADLESS_PATCH, original)
}
