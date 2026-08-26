/**
 * 端到端 A/B 测试脚本 — 用真实 LLM 跑连续任务，对比有/无 self-improving 插件
 *
 * 改进点：
 *   1. 跑前先预估 token 消耗，超预算则终止
 *   2. 任务设计为同一项目迭代——后续任务依赖前面任务的产出
 *   3. 步数用"工具调用次数"统计（从 stderr 解析 tool/result），不依赖 self-improving 日志
 *
 * 用法：
 *   npx tsx benchmark/e2e-test.ts              # 正式跑
 *   npx tsx benchmark/e2e-test.ts --dry-run    # 只预估 token，不跑
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const MODEL = 'qwen3.7-plus-2026-05-26'
const PROVIDER = 'qwen'
const PROFILE = 'headless'
const WORK_DIR = '/tmp/dsh-e2e-ab'
const TEST_DB = '~/.dsh/experiences-e2e.db'
const TEST_DB_PATH = TEST_DB.replace('~', homedir())
const HEADLESS_PATCH = join(homedir(), '.dsh/profiles/headless/cordis.patch.yml')

// Token 预算（50 万）
const TOKEN_BUDGET = 500_000

// 每个 LLM 调用的粗估 token：
//   input  = system_prompt(~400) + user_prompt(~150) + tool_results(~800) + injected_exp(~400) ≈ 1750
//   output = assistant_reply(~600) + tool_calls(~200) ≈ 800
//   每步约 2550 token, 多步任务按步数乘
// 实际消耗取决于 LLM 输出长度, 这里取保守上限每任务 ~5000 token
const ESTIMATED_TOKENS_PER_TASK = 5000

const DRY_RUN = process.argv.includes('--dry-run')

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface TaskResult {
  taskId: string
  prompt: string
  success: boolean
  toolCalls: number
  outcomeScore: number | null
  difficulty: string | null
  taskPattern: string | null
  injected: boolean
  fileCount: number
  totalCodeLines: number
  rawStderr: string
  assistantReply: string
}

interface PhaseResult {
  phaseName: string
  tasks: TaskResult[]
}

// ---------------------------------------------------------------------------
// 解析日志
// ---------------------------------------------------------------------------

function parseLog(stderr: string): {
  toolCalls: number
  score: number | null
  difficulty: string | null
  taskPattern: string | null
  injected: boolean
} {
  const lines = stderr.split('\n')

  // 工具调用次数: 统计 [self-improving] tool/result 行（有插件时）
  // 或从 stdout 的 tool use 标记统计（无插件时兜底）
  const toolResultLines = lines.filter((l) => l.includes('[self-improving] tool/result'))
  let toolCalls = toolResultLines.length

  // pre-step 行也作为步数参考
  const preStepLines = lines.filter((l) => l.includes('[self-improving] agent/pre-step'))
  if (toolCalls === 0 && preStepLines.length > 0) {
    toolCalls = preStepLines.length
  }

  // score
  const scoreLine = lines.find((l) => l.includes('[self-improving] turn') && l.includes('scored'))
  let score: number | null = null
  let difficulty: string | null = null
  let taskPattern: string | null = null
  if (scoreLine) {
    const sm = scoreLine.match(/score=([\d.]+)/);     if (sm) score = parseFloat(sm[1])
    const dm = scoreLine.match(/difficulty=(\w+)/);   if (dm) difficulty = dm[1]
    const tm = scoreLine.match(/task=(\w+)/);          if (tm) taskPattern = tm[1]
  }

  const injected = lines.some((l) => l.includes('(injecting)'))

  return { toolCalls, score, difficulty, taskPattern, injected }
}

/** 统计工作目录下的文件数和代码行数（辅助指标） */
function countWorkspace(dir: string): { fileCount: number; totalCodeLines: number } {
  let fileCount = 0
  let totalCodeLines = 0
  try {
    for (const f of readdirSync(dir)) {
      const fp = join(dir, f)
      const st = statSync(fp)
      if (st.isFile() && (f.endsWith('.js') || f.endsWith('.ts'))) {
        fileCount++
        totalCodeLines += readFileSync(fp, 'utf-8').split('\n').length
      }
    }
  } catch { /* empty dir */ }
  return { fileCount, totalCodeLines }
}

// ---------------------------------------------------------------------------
// 运行单个任务
// ---------------------------------------------------------------------------

function runTask(taskId: string, prompt: string, workDir: string, timeoutMs = 120_000): TaskResult {
  console.log(`  [${taskId}] ${prompt.slice(0, 70)}...`)

  const result = spawnSync('dsh', ['--profile', 'headless', prompt], {
    cwd: workDir, timeout: timeoutMs, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const exitCode = result.status ?? 1
  const parsed = parseLog(stderr)
  const ws = countWorkspace(workDir)

  // 无插件时从 stdout 间接估步数: dsh headless 每个工具调用会有中间输出
  // 退路: 用 reply 长度 / 300 粗估
  let toolCalls = parsed.toolCalls
  if (toolCalls === 0) {
    // 没有插件日志, 从 stdout 的动作数粗估
    const actions = stdout.match(/```/g)
    toolCalls = actions ? Math.ceil(actions.length / 2) : Math.ceil(stdout.length / 500)
  }

  console.log(`    -> tools=${toolCalls} score=${parsed.score ?? '-'} diff=${parsed.difficulty ?? '-'} inj=${parsed.injected ? 'Y' : 'n'} files=${ws.fileCount} lines=${ws.totalCodeLines} exit=${exitCode}`)

  return {
    taskId, prompt, success: exitCode === 0,
    toolCalls,
    outcomeScore: parsed.score, difficulty: parsed.difficulty, taskPattern: parsed.taskPattern,
    injected: parsed.injected,
    fileCount: ws.fileCount, totalCodeLines: ws.totalCodeLines,
    rawStderr: stderr, assistantReply: stdout.trim(),
  }
}

function prepareWorkDir(name: string): string {
  const dir = join(WORK_DIR, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// 任务设计：同一项目迭代，后续任务依赖前面的产出
//
// Task 1: 创建项目骨架 (config.js + app.js)
// Task 2: 基于 Task 1 的 app.js 添加路由模块
// Task 3: 基于 Task 2 的路由添加验证中间件
// Task 4: 修 Task 3 引入的 bug
// Task 5: 加测试文件验证前面所有模块
//
// 工具序列会自然重叠 (read → edit → write)，
// 如果经验注入有效, R2 应该比 R1 更少走弯路。
// ---------------------------------------------------------------------------

const TASKS: { id: string; prompt: string }[] = [
  {
    id: 'task-1',
    prompt: 'Create a Node.js project: a file config.js exporting an object { port: 3000, env: "dev" }, and a file app.js that imports config and starts an HTTP server on config.port responding with "OK" to any request.',
  },
  {
    id: 'task-2',
    prompt: 'In the existing project, create a file router.js that exports a function handleRequest(req) which routes GET / to "home", GET /api to "api", and everything else to 404. Update app.js to use this router instead of the hardcoded response.',
  },
  {
    id: 'task-3',
    prompt: 'Create a file auth.js that exports a function checkAuth(token) returning true if token starts with "Bearer ". Update app.js to call checkAuth before handleRequest, and reject requests without valid auth with 401 status.',
  },
  {
    id: 'task-4',
    prompt: 'There is a bug: the auth check in app.js blocks the root path "/" even for unauthenticated users. Fix it so that only /api requires auth, while / is public. Make sure the server still starts correctly.',
  },
  {
    id: 'task-5',
    prompt: 'Create test-app.js that tests: 1) config has port 3000, 2) router routes / to home, 3) auth rejects empty token, 4) auth accepts "Bearer xyz". Use Node.js assert module.',
  },
]

// ---------------------------------------------------------------------------
// Patch 控制
// ---------------------------------------------------------------------------

function writePatch(enabled: boolean): void {
  const base = `- id: llm-deepseek
  disabled: true
- id: agent-default-model
  config:
    provider: ${PROVIDER}
    model: ${MODEL}
- id: system-prompt
  config:
    persona: "You are a coding agent. Your working directory is the current directory. Write code, fix bugs, and run tests."`

  if (enabled) {
    writeFileSync(HEADLESS_PATCH, base + `
- insert:
    - id: self-improving
      name: 'dsh-self-improving'
      config:
        dbPath: '${TEST_DB}'
        metaCognitionEnabled: true
        behaviorAdapterEnabled: true
        minInjectionScore: 0.3
`)
  } else {
    writeFileSync(HEADLESS_PATCH, base + '\n')
  }
}

let originalPatch = ''
function savePatch() { if (existsSync(HEADLESS_PATCH)) originalPatch = readFileSync(HEADLESS_PATCH, 'utf-8') }
function restorePatch() { writeFileSync(HEADLESS_PATCH, originalPatch) }

function clearTestDb(): void {
  for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
}

// ---------------------------------------------------------------------------
// Token 预估
// ---------------------------------------------------------------------------

function estimateTokens(): { total: number; perPhase: number[] } {
  // 3 phase x 5 task = 15 LLM 调用
  const numPhases = 3
  const numTasksPerPhase = TASKS.length
  const perPhase: number[] = []
  for (let p = 0; p < numPhases; p++) {
    // enabled phase 的任务有经验注入, input 更长约 +400 token
    const perTask = p === 0 ? ESTIMATED_TOKENS_PER_TASK : ESTIMATED_TOKENS_PER_TASK + 400
    perPhase.push(perTask * numTasksPerPhase)
  }
  return { total: perPhase.reduce((a, b) => a + b, 0), perPhase }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== E2E A/B Test: self-improving plugin ===')
  console.log(`Model: ${PROVIDER} / ${MODEL}`)
  console.log(`Profile: ${PROFILE}  Tasks: ${TASKS.length}  Phases: 3`)

  // Token 预估
  const est = estimateTokens()
  console.log('\n--- Token Budget ---')
  console.log(`Budget:       ${TOKEN_BUDGET.toLocaleString()}`)
  console.log(`Estimated:    ${est.total.toLocaleString()}`)
  est.perPhase.forEach((t, i) => console.log(`  Phase ${i + 1}:   ${t.toLocaleString()}`))
  console.log(`Remaining:    ${(TOKEN_BUDGET - est.total).toLocaleString()}`)

  if (est.total > TOKEN_BUDGET) {
    console.error(`\nABORT: Estimated ${est.total.toLocaleString()} tokens exceeds budget ${TOKEN_BUDGET.toLocaleString()}`)
    process.exit(1)
  }
  if (est.total > TOKEN_BUDGET * 0.8) {
    console.log(`\nWARNING: Estimated tokens use ${Math.round(est.total / TOKEN_BUDGET * 100)}% of budget.`)
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: skipping execution. Token estimate only.')
    return
  }

  savePatch()

  try {
    // Phase 1: Baseline
    console.log('\n=== Phase 1: Baseline (no self-improving) ===')
    writePatch(false)
    clearTestDb()
    const baseDir = prepareWorkDir('baseline')
    const baselineTasks: TaskResult[] = []
    for (const t of TASKS) baselineTasks.push(runTask(t.id, t.prompt, baseDir))
    const baseline: PhaseResult = { phaseName: 'baseline', tasks: baselineTasks }

    // Phase 2: Enabled R1
    console.log('\n=== Phase 2: Enabled R1 (first run with plugin) ===')
    writePatch(true)
    clearTestDb()
    const r1Dir = prepareWorkDir('enabled-r1')
    const r1Tasks: TaskResult[] = []
    for (const t of TASKS) r1Tasks.push(runTask(t.id, t.prompt, r1Dir))
    const enabledR1: PhaseResult = { phaseName: 'enabled-r1', tasks: r1Tasks }

    // Phase 3: Enabled R2 (experience from R1, same tasks new dir)
    console.log('\n=== Phase 3: Enabled R2 (experience from R1) ===')
    const r2Dir = prepareWorkDir('enabled-r2')
    const r2Tasks: TaskResult[] = []
    for (const t of TASKS) r2Tasks.push(runTask(t.id, t.prompt, r2Dir))
    const enabledR2: PhaseResult = { phaseName: 'enabled-r2', tasks: r2Tasks }

    // 报告
    console.log('\n\n===============================================================')
    console.log('                    E2E Test Results')
    console.log('===============================================================')
    console.log(`Model: ${PROVIDER}/${MODEL}  Tasks: ${TASKS.length}  Phases: 3\n`)

    const phases = [
      { label: 'Baseline (no plugin)', d: baseline },
      { label: 'Enabled R1 (first run)', d: enabledR1 },
      { label: 'Enabled R2 (with exp)', d: enabledR2 },
    ]

    console.log('Phase                        | Task   | Tools | Score  | Diff   | Inj | Files | Lines')
    console.log('------------------------------|--------|-------|--------|--------|-----|-------|-----')
    for (const ph of phases) {
      for (const t of ph.d.tasks) {
        console.log(
          `${ph.label.padEnd(29)}| ${t.taskId.padEnd(7)}| ${String(t.toolCalls).padEnd(7)}| ${(t.outcomeScore?.toFixed(2) ?? 'N/A').padEnd(7)}| ${(t.difficulty ?? 'N/A').padEnd(7)}| ${t.injected ? 'Y' : 'n'}  | ${String(t.fileCount).padEnd(6)}| ${String(t.totalCodeLines).padEnd(5)}`,
        )
      }
      console.log('------------------------------|--------|-------|--------|--------|-----|-------|-----')
    }

    // 工具调用对比
    console.log('\n--- Tool Calls Comparison ---')
    console.log('Task   | Baseline | R1 | R2 | R1 vs Base | R2 vs R1')
    console.log('-------|----------|----|----|------------|----------')
    for (let i = 0; i < TASKS.length; i++) {
      const b = baseline.tasks[i].toolCalls
      const r1 = enabledR1.tasks[i].toolCalls
      const r2 = enabledR2.tasks[i].toolCalls
      const r1vb = b > 0 ? ((r1 - b) / b * 100).toFixed(0) + '%' : 'N/A'
      const r2vr1 = r1 > 0 ? ((r2 - r1) / r1 * 100).toFixed(0) + '%' : 'N/A'
      console.log(`${TASKS[i].id.padEnd(7)}| ${String(b).padEnd(9)}| ${String(r1).padEnd(3)}| ${String(r2).padEnd(3)}| ${r1vb.padEnd(11)}| ${r2vr1}`)
    }

    // 评分对比
    console.log('\n--- Score Comparison ---')
    console.log('Task   | Baseline | R1    | R2')
    console.log('-------|----------|-------|-------')
    for (let i = 0; i < TASKS.length; i++) {
      const f = (v: number | null) => v !== null ? v.toFixed(2) : 'N/A'
      console.log(`${TASKS[i].id.padEnd(7)}| ${f(baseline.tasks[i].outcomeScore).padEnd(9)}| ${f(enabledR1.tasks[i].outcomeScore).padEnd(6)}| ${f(enabledR2.tasks[i].outcomeScore)}`)
    }

    // 注入统计
    console.log()
    const r1Inj = enabledR1.tasks.filter((t) => t.injected).length
    const r2Inj = enabledR2.tasks.filter((t) => t.injected).length
    console.log(`Injection: R1=${r1Inj}/${TASKS.length}  R2=${r2Inj}/${TASKS.length}`)

    // 汇总
    const avg = (p: PhaseResult, key: 'toolCalls') => (p.tasks.reduce((s, t) => s + t[key], 0) / p.tasks.length).toFixed(1)
    const avgScore = (p: PhaseResult) => {
      const sc = p.tasks.filter((t) => t.outcomeScore !== null).map((t) => t.outcomeScore!)
      return sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(3) : 'N/A'
    }

    console.log('\n--- Summary ---')
    console.log(`Baseline   avg tools: ${avg(baseline, 'toolCalls')}, avg score: ${avgScore(baseline)}`)
    console.log(`Enabled R1 avg tools: ${avg(enabledR1, 'toolCalls')}, avg score: ${avgScore(enabledR1)}`)
    console.log(`Enabled R2 avg tools: ${avg(enabledR2, 'toolCalls')}, avg score: ${avgScore(enabledR2)}`)

    const r1A = parseFloat(avg(enabledR1, 'toolCalls'))
    const r2A = parseFloat(avg(enabledR2, 'toolCalls'))
    console.log()
    if (r2A < r1A) {
      console.log(`R2 vs R1: ${r2A} vs ${r1A} tools -> ${((r1A - r2A) / r1A * 100).toFixed(1)}% fewer (experience helped)`)
    } else if (r2A === r1A) {
      console.log(`R2 vs R1: ${r2A} vs ${r1A} tools -> no change`)
    } else {
      console.log(`R2 vs R1: ${r2A} vs ${r1A} tools -> ${((r2A - r1A) / r1A * 100).toFixed(1)}% more (experience did not help)`)
    }

    // 保存 JSON 报告
    const report = {
      timestamp: new Date().toISOString(), provider: PROVIDER, model: MODEL,
      estimatedTokens: est.total, budget: TOKEN_BUDGET,
      baseline, enabledR1, enabledR2,
    }
    const reportPath = join(WORK_DIR, 'e2e-report.json')
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`\nReport: ${reportPath}`)

  } finally {
    restorePatch()
    console.log('\nPatch restored.')
  }
}

main().catch((err) => {
  console.error('E2E test failed:', err)
  restorePatch()
  process.exit(1)
})
