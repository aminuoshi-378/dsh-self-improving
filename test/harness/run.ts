/**
 * Harness E2E 测试框架 — 主运行器
 *
 * 架构:
 *
 *   测试 agent (LLM)          DSH A (with self-improving)    DSH B (without)
 *   ┌─────────────┐           ┌─────────────┐               ┌─────────────┐
 *   │ 生成 prompt  │──prompt──→│ dsh headless │               │ dsh headless │
 *   │ 看输出决定   │←─output──│ (有经验注入) │               │ (无经验注入) │
 *   │ 下一步      │           └─────────────┘               └─────────────┘
 *   │             │──prompt──────────────────────────────────→│             │
 *   │             │←─output───────────────────────────────────│             │
 *   │ 评估质量     │           工作目录 A                      工作目录 B
 *   └─────────────┘
 *
 * 流程:
 *   1. 测试 agent 生成第一个 prompt
 *   2. 同一个 prompt 同时发给 DSH A (with-self) 和 DSH B (without-self)
 *   3. 测试 agent 看两个 dsh 的输出，决定下一步 prompt
 *   4. 重复 3-6 轮
 *   5. 测试 agent 分别评估两个工作目录的代码质量
 *   6. 输出对比报告
 *
 * Token 消耗:
 *   - 测试 agent: 每轮 1 次 LLM 调用 (约 2000 token)
 *   - DSH A: 每轮 1 次 (约 5000 token)
 *   - DSH B: 每轮 1 次 (约 5000 token)
 *   - 评估: 2 次 (约 2000 token)
 *   - 6 轮总计: 约 6*12000 + 4000 = ~76,000 token
 *
 * 用法:
 *   npx tsx test/harness/run.ts [options]
 *
 * 选项:
 *   --scenario <text>   任务场景描述 (默认: 构建 REST API)
 *   --rounds <n>         交互轮数上限 (默认: 6)
 *   --model <name>       DSH 用的 model (默认: qwen3.7-plus-2026-05-26)
 *   --agent-model <name> 测试 agent 用的 model (默认: 同 DSH)
 *   --dry-run            只预估 token，不执行
 */

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateInitialPrompt, decideNextAction } from './test-agent.js'
import { runDshTask, writePatch, savePatch, restorePatch, countWorkspace } from './dsh-runner.js'
import type { InteractionTurn, InstanceHistory, ComparisonResult } from './types.js'

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

function getArg(name: string, def: string): string {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def
}

function getArgNum(name: string, def: number): number {
  return parseInt(getArg(name, String(def)))
}

const DSH_MODEL = getArg('model', 'qwen3.7-plus-2026-05-26')
const AGENT_MODEL = getArg('agent-model', DSH_MODEL)
const MAX_ROUNDS = getArgNum('rounds', 6)
const SCENARIO = getArg('scenario', 'Build a REST API for a todo app with CRUD endpoints, input validation, error handling, and unit tests')
const DRY_RUN = args.includes('--dry-run')

const PROVIDER = 'qwen'
const WORK_DIR = '/tmp/harness-e2e'
const TEST_DB = '~/.dsh/experiences-harness.db'
const TEST_DB_PATH = TEST_DB.replace('~', homedir())
const TOKEN_BUDGET = 500_000

const ESTIMATED_TOKENS_PER_ROUND = 12_000  // agent(2k) + dsh-a(5k) + dsh-b(5k)
const ESTIMATED_EVAL_TOKENS = 4_000       // 2 evaluations

// ---------------------------------------------------------------------------
// Token 预估
// ---------------------------------------------------------------------------

function estimateTokens(): number {
  return MAX_ROUNDS * ESTIMATED_TOKENS_PER_ROUND + ESTIMATED_EVAL_TOKENS
}

// ---------------------------------------------------------------------------
// 运行单个 dsh 实例的多轮交互
// ---------------------------------------------------------------------------

function runInstance(
  instanceId: string,
  enabled: boolean,
  agentHistory: { prompt: string; intent: string }[],
  workDir: string,
): InstanceHistory {
  console.log(`\n  [${instanceId}] Running ${agentHistory.length} turns in ${workDir}`)

  const turns: InteractionTurn[] = []

  // 切换 patch
  writePatch({
    model: DSH_MODEL,
    provider: PROVIDER,
    enabled,
    dbPath: TEST_DB,
  })

  for (let i = 0; i < agentHistory.length; i++) {
    const { prompt, intent } = agentHistory[i]
    console.log(`    [${instanceId}] Turn ${i + 1}: ${prompt.slice(0, 60)}...`)

    const turn = runDshTask(prompt, workDir)
    turn.intent = intent
    turns.push(turn)

    console.log(`      -> tools=${turn.toolCalls} score=${turn.outcomeScore ?? '-'} inj=${turn.injected ? 'Y' : 'n'}`)
  }

  return {
    instanceId,
    workDir,
    turns,
    qualityScore: null,
    qualityReason: null,
  }
}

// ---------------------------------------------------------------------------
// 评估代码质量
// ---------------------------------------------------------------------------

function evaluateQuality(
  instanceId: string,
  workDir: string,
  scenario: string,
): { score: number; reason: string } {
  // 读取工作目录中的所有代码文件
  const files: { name: string; content: string }[] = []
  try {
    for (const f of readdirSync(workDir)) {
      const fp = join(workDir, f)
      if (statSync(fp).isFile() && (f.endsWith('.js') || f.endsWith('.ts'))) {
        files.push({ name: f, content: readFileSyncContent(fp) })
      }
    }
  } catch {}

  if (files.length === 0) {
    return { score: 0, reason: 'No code files found in workspace' }
  }

  const filesText = files
    .map((f) => `--- ${f.name} ---\n${f.content.slice(0, 2000)}\n`)
    .join('\n')

  const evalPrompt = `You are a senior code reviewer. Evaluate the following code for a project with this goal:

Goal: ${scenario}

Code files:
${filesText}

Rate the code quality from 1-10 based on:
- Correctness: Does it do what was asked?
- Completeness: Are all features implemented?
- Code quality: Is it clean, readable, follows best practices?
- Error handling: Are edge cases handled?

Respond in this format:
SCORE: <1-10>
REASON: <1-2 sentences explaining the score>`

  const { spawnSync } = require('node:child_process')
  const result = spawnSync('dsh', ['--profile', 'headless', evalPrompt], {
    cwd: '/tmp',
    timeout: 60_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const output = (result.stdout || '').trim()
  const scoreMatch = output.match(/SCORE:\s*(\d+)/)
  const reasonMatch = output.match(/REASON:\s*(.+)/s)

  return {
    score: scoreMatch ? parseInt(scoreMatch[1]) : 5,
    reason: reasonMatch ? reasonMatch[1].trim() : 'Evaluation inconclusive',
  }
}

function readFileSyncContent(fp: string): string {
  try {
    return require('node:fs').readFileSync(fp, 'utf-8')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Harness E2E: Agent-Driven Comparison ===')
  console.log(`DSH Model:      ${PROVIDER} / ${DSH_MODEL}`)
  console.log(`Test Agent Model: ${AGENT_MODEL}`)
  console.log(`Scenario:       ${SCENARIO.slice(0, 80)}...`)
  console.log(`Max Rounds:     ${MAX_ROUNDS}`)

  const estTokens = estimateTokens()
  console.log('\n--- Token Budget ---')
  console.log(`Budget:       ${TOKEN_BUDGET.toLocaleString()}`)
  console.log(`Estimated:    ${estTokens.toLocaleString()} (${MAX_ROUNDS} rounds x ${ESTIMATED_TOKENS_PER_ROUND.toLocaleString()} + ${ESTIMATED_EVAL_TOKENS.toLocaleString()} eval)`)
  console.log(`Remaining:    ${(TOKEN_BUDGET - estTokens).toLocaleString()}`)

  if (estTokens > TOKEN_BUDGET) {
    console.error(`\nABORT: Estimated ${estTokens.toLocaleString()} > budget ${TOKEN_BUDGET.toLocaleString()}`)
    process.exit(1)
  }
  if (estTokens > TOKEN_BUDGET * 0.8) {
    console.log(`WARNING: ${(estTokens / TOKEN_BUDGET * 100).toFixed(0)}% of budget.`)
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: skipping execution.')
    return
  }

  const originalPatch = savePatch()

  try {
    // ---------------------------------------------------------------
    // Phase 1: 测试 agent 生成交互序列
    // ---------------------------------------------------------------
    console.log('\n=== Phase 1: Test agent generates interaction ===')

    // 先清空测试 DB
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
      if (existsSync(f)) rmSync(f, { force: true })
    }

    const agentHistory: { prompt: string; intent: string }[] = []
    const interactionLog: { prompt: string; dshOutputA: string; dshOutputB: string }[] = []

    // 准备两个工作目录
    const dirA = join(WORK_DIR, 'with-self')
    const dirB = join(WORK_DIR, 'without-self')
    rmSync(WORK_DIR, { recursive: true, force: true })
    mkdirSync(dirA, { recursive: true })
    mkdirSync(dirB, { recursive: true })

    // 生成第一个 prompt
    console.log('\n  [test-agent] Generating initial prompt...')
    const initial = generateInitialPrompt(AGENT_MODEL, SCENARIO)
    agentHistory.push(initial)
    console.log(`  [test-agent] Initial: "${initial.prompt.slice(0, 80)}..."`)

    // 第一轮: 同时跑两个 dsh 实例
    console.log('\n  --- Round 1 ---')
    const turn1A = runDshTask(initial.prompt, dirA)
    const turn1B = runDshTask(initial.prompt, dirB)
    interactionLog.push({ prompt: initial.prompt, dshOutputA: turn1A.dshOutput, dshOutputB: turn1B.dshOutput })

    console.log(`    with-self:    tools=${turn1A.toolCalls} score=${turn1A.outcomeScore ?? '-'} inj=${turn1A.injected ? 'Y' : 'n'}`)
    console.log(`    without-self:  tools=${turn1B.toolCalls} score=${turn1B.outcomeScore ?? '-'} inj=${turn1B.injected ? 'Y' : 'n'}`)

    // 后续轮次: 测试 agent 看输出后决定下一步
    for (let round = 2; round <= MAX_ROUNDS; round++) {
      console.log(`\n  --- Round ${round} ---`)
      console.log('  [test-agent] Deciding next action...')

      // 测试 agent 看 with-self 的输出来决定（用 with-self 的输出作为主要参考）
      const action = decideNextAction(AGENT_MODEL, SCENARIO, interactionLog.map(l => ({ prompt: l.prompt, dshOutput: l.dshOutputA })))

      if (action.type === 'evaluate' || action.type === 'done') {
        if (action.type === 'evaluate') {
          console.log(`  [test-agent] Evaluate: score=${action.qualityScore} reason=${action.reason.slice(0, 60)}`)
        }
        console.log(`  [test-agent] Done after ${round - 1} rounds.`)
        break
      }

      console.log(`  [test-agent] Prompt: "${action.content.slice(0, 80)}..." (intent: ${action.intent})`)
      agentHistory.push({ prompt: action.content, intent: action.intent })

      // 同一个 prompt 同时发给两个 dsh
      const turnA = runDshTask(action.content, dirA)
      const turnB = runDshTask(action.content, dirB)
      interactionLog.push({ prompt: action.content, dshOutputA: turnA.dshOutput, dshOutputB: turnB.dshOutput })

      console.log(`    with-self:    tools=${turnA.toolCalls} score=${turnA.outcomeScore ?? '-'} inj=${turnA.injected ? 'Y' : 'n'}`)
      console.log(`    without-self:  tools=${turnB.toolCalls} score=${turnB.outcomeScore ?? '-'} inj=${turnB.injected ? 'Y' : 'n'}`)
    }

    // ---------------------------------------------------------------
    // Phase 2: 重跑完整序列到两个工作目录
    // ---------------------------------------------------------------
    console.log('\n=== Phase 2: Replay full interaction to each instance ===')

    // with-self: 清空工作目录, 带 self-improving 重跑
    rmSync(dirA, { recursive: true, force: true })
    mkdirSync(dirA, { recursive: true })
    // 不清 DB — 让经验在多轮中积累
    const withSelfHistory = runInstance('with-self', true, agentHistory, dirA)

    // without-self: 清空工作目录, 不带 self-improving 重跑
    rmSync(dirB, { recursive: true, force: true })
    mkdirSync(dirB, { recursive: true })
    const withoutSelfHistory = runInstance('without-self', false, agentHistory, dirB)

    // ---------------------------------------------------------------
    // Phase 3: 评估代码质量
    // ---------------------------------------------------------------
    console.log('\n=== Phase 3: Quality Evaluation ===')

    writePatch({ model: DSH_MODEL, provider: PROVIDER, enabled: false, dbPath: TEST_DB })

    console.log('  Evaluating with-self workspace...')
    const evalA = evaluateQuality('with-self', dirA, SCENARIO)
    withSelfHistory.qualityScore = evalA.score
    withSelfHistory.qualityReason = evalA.reason
    console.log(`    Score: ${evalA.score} — ${evalA.reason.slice(0, 80)}`)

    console.log('  Evaluating without-self workspace...')
    const evalB = evaluateQuality('without-self', dirB, SCENARIO)
    withoutSelfHistory.qualityScore = evalB.score
    withoutSelfHistory.qualityReason = evalB.reason
    console.log(`    Score: ${evalB.score} — ${evalB.reason.slice(0, 80)}`)

    // ---------------------------------------------------------------
    // Phase 4: 对比报告
    // ---------------------------------------------------------------
    console.log('\n\n===============================================================')
    console.log('              Harness E2E Comparison Report')
    console.log('===============================================================')
    console.log(`DSH Model: ${PROVIDER}/${DSH_MODEL}  Agent Model: ${AGENT_MODEL}`)
    console.log(`Scenario: ${SCENARIO.slice(0, 80)}...`)
    console.log(`Rounds: ${withSelfHistory.turns.length}\n`)

    // 逐轮对比
    console.log('Turn  | with-self tools | without tools | with-self score | without score | with-self inj')
    console.log('------|----------------|---------------|-----------------|---------------|--------------')
    for (let i = 0; i < withSelfHistory.turns.length; i++) {
      const a = withSelfHistory.turns[i]
      const b = withoutSelfHistory.turns[i]
      console.log(
        `${String(i + 1).padEnd(6)}| ${String(a.toolCalls).padEnd(15)}| ${String(b.toolCalls).padEnd(14)}| ${(a.outcomeScore?.toFixed(2) ?? 'N/A').padEnd(16)}| ${(b.outcomeScore?.toFixed(2) ?? 'N/A').padEnd(14)}| ${a.injected ? 'Y' : 'n'}`,
      )
    }

    // 汇总
    const avgTools = (h: InstanceHistory) => (h.turns.reduce((s, t) => s + t.toolCalls, 0) / h.turns.length).toFixed(1)
    const avgScore = (h: InstanceHistory) => {
      const sc = h.turns.filter((t) => t.outcomeScore !== null).map((t) => t.outcomeScore!)
      return sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(3) : null
    }
    const totalInj = (h: InstanceHistory) => h.turns.filter((t) => t.injected).length

    const result: ComparisonResult = {
      timestamp: new Date().toISOString(),
      testAgentModel: AGENT_MODEL,
      dshModel: DSH_MODEL,
      scenario: SCENARIO,
      withSelf: withSelfHistory,
      withoutSelf: withoutSelfHistory,
      summary: {
        withSelfAvgTools: parseFloat(avgTools(withSelfHistory)),
        withoutSelfAvgTools: parseFloat(avgTools(withoutSelfHistory)),
        withSelfAvgScore: avgScore(withSelfHistory) ? parseFloat(avgScore(withSelfHistory)!) : null,
        withoutSelfAvgScore: avgScore(withoutSelfHistory) ? parseFloat(avgScore(withoutSelfHistory)!) : null,
        withSelfQuality: withSelfHistory.qualityScore,
        withoutSelfQuality: withoutSelfHistory.qualityScore,
        withSelfInjections: totalInj(withSelfHistory),
        withoutSelfInjections: totalInj(withoutSelfHistory),
        withSelfTurns: withSelfHistory.turns.length,
        withoutSelfTurns: withoutSelfHistory.turns.length,
      },
    }

    console.log('\n--- Summary ---')
    console.log(`                    with-self    without-self    delta`)
    console.log(`Avg tool calls:     ${result.summary.withSelfAvgTools.toString().padEnd(13)}${result.summary.withoutSelfAvgTools.toString().padEnd(15)}${(result.summary.withSelfAvgTools - result.summary.withoutSelfAvgTools).toFixed(1)}`)
    console.log(`Avg outcome score:  ${(result.summary.withSelfAvgScore ?? 'N/A').toString().padEnd(13)}${(result.summary.withoutSelfAvgScore ?? 'N/A').toString().padEnd(15)}${result.summary.withSelfAvgScore && result.summary.withoutSelfAvgScore ? (result.summary.withSelfAvgScore - result.summary.withoutSelfAvgScore).toFixed(3) : 'N/A'}`)
    console.log(`Quality score:      ${(result.summary.withSelfQuality ?? 'N/A').toString().padEnd(13)}${(result.summary.withoutSelfQuality ?? 'N/A').toString().padEnd(15)}${result.summary.withSelfQuality && result.summary.withoutSelfQuality ? (result.summary.withSelfQuality - result.summary.withoutSelfQuality).toFixed(0) : 'N/A'}`)
    console.log(`Injections:         ${result.summary.withSelfInjections.toString().padEnd(13)}${result.summary.withoutSelfInjections.toString().padEnd(15)}`)
    console.log(`Turns:              ${result.summary.withSelfTurns.toString().padEnd(13)}${result.summary.withoutSelfTurns.toString().padEnd(15)}`)

    // 测试 agent 的每轮意图
    console.log('\n--- Test Agent Intentions ---')
    agentHistory.forEach((h, i) => {
      console.log(`  Turn ${i + 1}: [${h.intent}] ${h.prompt.slice(0, 70)}...`)
    })

    // 保存报告
    const reportPath = join(WORK_DIR, 'harness-report.json')
    writeFileSync(reportPath, JSON.stringify(result, null, 2))
    console.log(`\nReport: ${reportPath}`)

  } finally {
    restorePatch(originalPatch)
    console.log('\nPatch restored.')
  }
}

main().catch((err) => {
  console.error('Harness E2E failed:', err)
  process.exit(1)
})
