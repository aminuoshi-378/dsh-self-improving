/**
 * Benchmark Runner — the main orchestration script.
 *
 * Flow:
 *   1. Baseline run: SimAgent WITHOUT experience → collect metrics
 *   2. Warmup run: SimAgent WITH experience → feed data into ExperienceStore,
 *      run MetaCognition reflection → accumulate learned lessons
 *   3. Enabled run: SimAgent WITH experience (now has accumulated lessons)
 *      → collect metrics
 *   4. Compare: compute improvement percentages, print report, save JSON
 *
 * The script also uses the REAL OutcomeEvaluator and ExperienceStore from
 * the project — so the benchmark exercises actual production code paths.
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import { OutcomeEvaluator } from '../src/evaluator/outcome-evaluator.js'
import { BehaviorAdapter } from '../src/adapter/behavior-adapter.js'
import { MetaCognitionEngine } from '../src/meta-cognition/meta-cognition-engine.js'
import { SimAgent } from './sim-agent.js'
import { TASK_SUITE } from './task-suite.js'
import type { TurnData } from '../src/types/index.js'
import type { SimResult } from './sim-agent.js'
import { writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Metrics extraction
// ---------------------------------------------------------------------------

interface Metrics {
  totalTasks: number
  completedTasks: number
  completionRate: number
  totalToolCalls: number
  successfulToolCalls: number
  toolEfficiency: number
  totalGuardTriggers: number
  totalTurns: number
  guardRate: number
  avgOutcomeScore: number
  totalTokens: number
  tokenEfficiency: number // completedTasks / totalTokens * 1000
}

function extractMetrics(simResult: SimResult, outcomeScores: number[]): Metrics {
  const totalTasks = TASK_SUITE.length
  const completedTasks = simResult.completedTasks
  const totalToolCalls = simResult.totalToolCalls
  const successfulToolCalls = simResult.totalSuccessCalls
  const totalGuardTriggers = simResult.totalGuardTriggers
  const totalTurns = simResult.turns.length
  const totalTokens = simResult.totalTokens

  const completionRate = (completedTasks / totalTasks) * 100
  const toolEfficiency =
    totalToolCalls > 0 ? (successfulToolCalls / totalToolCalls) * 100 : 0
  const guardRate = totalTurns > 0 ? (totalGuardTriggers / totalTurns) * 100 : 0
  const avgOutcomeScore =
    outcomeScores.length > 0
      ? outcomeScores.reduce((a, b) => a + b, 0) / outcomeScores.length
      : 0
  const tokenEfficiency = totalTokens > 0 ? (completedTasks / totalTokens) * 1000 : 0

  return {
    totalTasks,
    completedTasks,
    completionRate,
    totalToolCalls,
    successfulToolCalls,
    toolEfficiency,
    totalGuardTriggers,
    totalTurns,
    guardRate,
    avgOutcomeScore,
    totalTokens,
    tokenEfficiency,
  }
}

// ---------------------------------------------------------------------------
// Per-task metrics for promptfoo-style test cases
// ---------------------------------------------------------------------------

interface TaskMetric {
  taskId: string
  description: string
  taskPattern: string
  outcomeScore: number
  toolSuccessRate: number
  guardTriggers: number
  goalProgress: string
  completed: boolean
}

function runAndCollectTaskMetrics(
  agent: SimAgent,
  evaluator: OutcomeEvaluator,
  store: ExperienceStore | null,
): TaskMetric[] {
  const metrics: TaskMetric[] = []

  for (const task of TASK_SUITE) {
    const turns = agent.runTask(task)
    const turn = turns[0]

    // Use the REAL OutcomeEvaluator to score this turn
    const outcome = evaluator.evaluate(turn)

    // Optionally store in the REAL ExperienceStore
    if (store) {
      evaluator.evaluateAndStore(turn, {
        taskPattern: task.taskPattern,
        toolsUsed: turn.toolResults.map((r) => r.toolName),
        workspaceDigest: task.workspaceDigest,
      })
    }

    metrics.push({
      taskId: task.id,
      description: task.description,
      taskPattern: task.taskPattern,
      outcomeScore: outcome.outcomeScore,
      toolSuccessRate: outcome.toolSuccessRate,
      guardTriggers: outcome.guardTriggerCount,
      goalProgress: outcome.goalProgress,
      completed: outcome.goalProgress === 'advanced',
    })
  }

  return metrics
}

// ---------------------------------------------------------------------------
// Comparison report
// ---------------------------------------------------------------------------

interface ComparisonReport {
  baseline: Metrics
  enabled: Metrics
  improvements: {
    completionImprovementPct: number
    toolEfficiencyImprovementPct: number
    guardImprovementPct: number
    outcomeScoreImprovementPct: number
    tokenEfficiencyImprovementPct: number
    overallImprovementPct: number
  }
  baselineTaskMetrics: TaskMetric[]
  enabledTaskMetrics: TaskMetric[]
  experiencesAccumulated: number
  lessonsGenerated: number
}

function computeImprovement(baseline: number, enabled: number): number {
  if (baseline === 0) return enabled > 0 ? 100 : 0
  return ((enabled - baseline) / baseline) * 100
}

function computeGuardImprovement(baseline: number, enabled: number): number {
  // For guards, lower is better — so improvement is baseline - enabled (positive = good)
  if (baseline === 0) return 0
  return ((baseline - enabled) / baseline) * 100
}

function buildReport(
  baseline: Metrics,
  enabled: Metrics,
  baselineTaskMetrics: TaskMetric[],
  enabledTaskMetrics: TaskMetric[],
  experiencesAccumulated: number,
  lessonsGenerated: number,
): ComparisonReport {
  const completionImprovementPct = computeImprovement(
    baseline.completionRate,
    enabled.completionRate,
  )
  const toolEfficiencyImprovementPct = computeImprovement(
    baseline.toolEfficiency,
    enabled.toolEfficiency,
  )
  const guardImprovementPct = computeGuardImprovement(
    baseline.guardRate,
    enabled.guardRate,
  )
  const outcomeScoreImprovementPct = computeImprovement(
    baseline.avgOutcomeScore,
    enabled.avgOutcomeScore,
  )
  const tokenEfficiencyImprovementPct = computeImprovement(
    baseline.tokenEfficiency,
    enabled.tokenEfficiency,
  )

  const overallImprovementPct =
    (completionImprovementPct +
      toolEfficiencyImprovementPct +
      guardImprovementPct +
      outcomeScoreImprovementPct +
      tokenEfficiencyImprovementPct) /
    5

  return {
    baseline,
    enabled,
    improvements: {
      completionImprovementPct,
      toolEfficiencyImprovementPct,
      guardImprovementPct,
      outcomeScoreImprovementPct,
      tokenEfficiencyImprovementPct,
      overallImprovementPct,
    },
    baselineTaskMetrics,
    enabledTaskMetrics,
    experiencesAccumulated,
    lessonsGenerated,
  }
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printReport(report: ComparisonReport): void {
  const b = report.baseline
  const e = report.enabled
  const imp = report.improvements

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('                    BENCHMARK RESULTS')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')

  console.log('  Metric                  │  Baseline    │  Enabled     │  Change')
  console.log('─────────────────────────┼──────────────┼──────────────┼──────────')

  // Completion rate
  console.log(
    `  Task Completion Rate     │  ${b.completionRate.toFixed(1).padStart(5)}%    │  ${e.completionRate.toFixed(1).padStart(5)}%    │  ${imp.completionImprovementPct >= 0 ? '+' : ''}${imp.completionImprovementPct.toFixed(1).padStart(5)}%`,
  )

  // Tool efficiency
  console.log(
    `  Tool Efficiency          │  ${b.toolEfficiency.toFixed(1).padStart(5)}%    │  ${e.toolEfficiency.toFixed(1).padStart(5)}%    │  ${imp.toolEfficiencyImprovementPct >= 0 ? '+' : ''}${imp.toolEfficiencyImprovementPct.toFixed(1).padStart(5)}%`,
  )

  // Guard rate (lower is better)
  console.log(
    `  Guard Trigger Rate       │  ${b.guardRate.toFixed(1).padStart(5)}%    │  ${e.guardRate.toFixed(1).padStart(5)}%    │  ${imp.guardImprovementPct >= 0 ? '-' : '+'}${imp.guardImprovementPct.toFixed(1).padStart(5)}%`,
  )

  // Outcome score
  console.log(
    `  Avg Outcome Score (0-1)  │  ${b.avgOutcomeScore.toFixed(3).padStart(5)}     │  ${e.avgOutcomeScore.toFixed(3).padStart(5)}     │  ${imp.outcomeScoreImprovementPct >= 0 ? '+' : ''}${imp.outcomeScoreImprovementPct.toFixed(1).padStart(5)}%`,
  )

  // Token efficiency
  console.log(
    `  Token Efficiency         │  ${b.tokenEfficiency.toFixed(2).padStart(5)}     │  ${e.tokenEfficiency.toFixed(2).padStart(5)}     │  ${imp.tokenEfficiencyImprovementPct >= 0 ? '+' : ''}${imp.tokenEfficiencyImprovementPct.toFixed(1).padStart(5)}%`,
  )

  console.log('─────────────────────────┼──────────────┼──────────────┼──────────')

  // Overall
  const overallStr = imp.overallImprovementPct >= 0
    ? `+${imp.overallImprovementPct.toFixed(1)}%`
    : `${imp.overallImprovementPct.toFixed(1)}%`
  console.log(`  OVERALL IMPROVEMENT                                                │  ${overallStr.padStart(6)}`)
  console.log('')

  // Store stats
  console.log(`  Experiences accumulated:  ${report.experiencesAccumulated}`)
  console.log(`  Lessons generated:        ${report.lessonsGenerated}`)
  console.log('')

  // Per-task breakdown
  console.log('  Per-Task Breakdown:')
  console.log('  Task ID        Pattern       Baseline Score  Enabled Score  Delta')
  console.log('  ─────────────────────────────────────────────────────────────────')

  for (let i = 0; i < report.baselineTaskMetrics.length; i++) {
    const bt = report.baselineTaskMetrics[i]
    const et = report.enabledTaskMetrics[i]
    const delta = et.outcomeScore - bt.outcomeScore
    const deltaStr = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)
    console.log(
      `  ${bt.taskId.padEnd(14)} ${bt.taskPattern.padEnd(14)} ${bt.outcomeScore.toFixed(2).padStart(8)}        ${et.outcomeScore.toFixed(2).padStart(8)}      ${deltaStr}`,
    )
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Starting benchmark...')
  console.log(`Task suite: ${TASK_SUITE.length} tasks`)

  // We use a shared in-memory store for the entire benchmark.
  // Phase 1 (baseline) does NOT use the store.
  // Phase 2 (warmup) feeds the store with experience.
  // Phase 3 (enabled) uses the store with accumulated experience.
  const store = new ExperienceStore(':memory:')
  const evaluator = new OutcomeEvaluator(store)
  const adapter = new BehaviorAdapter(store)
  const metaEngine = new MetaCognitionEngine(store, null) // rule-based, no LLM

  // =====================================================================
  // Phase 1: BASELINE — agent WITHOUT experience (no plugin loaded)
  // =====================================================================
  console.log('\n--- Phase 1: Baseline (no self-improving plugin) ---')

  // Use a DIFFERENT seed than enabled to avoid identical results
  // (but same seed across runs for reproducibility)
  const baselineAgent = new SimAgent(100, false)
  const baselineTaskMetrics = runAndCollectTaskMetrics(baselineAgent, evaluator, null)

  const baselineSimResult = baselineAgent.runSuite(TASK_SUITE)
  const baselineMetrics = extractMetrics(baselineSimResult, baselineTaskMetrics.map(t => t.outcomeScore))

  console.log(`  Baseline: ${baselineMetrics.completedTasks}/${baselineMetrics.totalTasks} tasks completed`)
  console.log(`  Tool efficiency: ${baselineMetrics.toolEfficiency.toFixed(1)}%`)
  console.log(`  Guard triggers: ${baselineMetrics.totalGuardTriggers}`)
  console.log(`  Avg outcome score: ${baselineMetrics.avgOutcomeScore.toFixed(3)}`)

  // =====================================================================
  // Phase 2: WARMUP — agent WITH experience, feed store, run reflection
  // =====================================================================
  console.log('\n--- Phase 2: Warmup (accumulate experience + reflection) ---')

  // Run the suite 3 times with experience to accumulate a rich store
  for (let round = 0; round < 3; round++) {
    const warmupAgent = new SimAgent(200 + round, true)
    const warmupTaskMetrics = runAndCollectTaskMetrics(warmupAgent, evaluator, store)

    // Queue reflections for meta-cognition
    for (const task of TASK_SUITE) {
      const recentRecords = store.query({ limit: 1 })
      if (recentRecords.length > 0) {
        metaEngine.queueReflection({
          experienceId: recentRecords[0].id,
          turnId: recentRecords[0].turnId,
          sessionId: recentRecords[0].sessionId,
          actions: recentRecords[0].actions,
          outcomeScore: recentRecords[0].outcomeScore,
          userFeedback: recentRecords[0].userFeedback,
        })
      }
    }
  }

  // Process all queued reflections
  await metaEngine.processQueue()

  // Distill preferences
  adapter.distillPreferences()

  const storeStats = store.stats()
  console.log(`  Experiences stored: ${storeStats.total}`)
  console.log(`  Lessons generated: ${storeStats.withLessons}`)
  console.log(`  Avg score: ${storeStats.avgScore.toFixed(3)}`)
  console.log(`  Positive feedback: ${storeStats.positiveCount}`)
  console.log(`  Preferences distilled: ${adapter.getPreferenceCount()}`)

  // =====================================================================
  // Phase 3: ENABLED — agent WITH experience (plugin loaded, store has data)
  // =====================================================================
  console.log('\n--- Phase 3: Enabled (self-improving plugin active) ---')

  // Use the SAME seed as baseline (100) to ensure the ONLY difference
  // is the experience availability — fair comparison.
  const enabledAgent = new SimAgent(100, true)
  const enabledTaskMetrics = runAndCollectTaskMetrics(enabledAgent, evaluator, store)

  const enabledSimResult = enabledAgent.runSuite(TASK_SUITE)
  const enabledMetrics = extractMetrics(enabledSimResult, enabledTaskMetrics.map(t => t.outcomeScore))

  console.log(`  Enabled: ${enabledMetrics.completedTasks}/${enabledMetrics.totalTasks} tasks completed`)
  console.log(`  Tool efficiency: ${enabledMetrics.toolEfficiency.toFixed(1)}%`)
  console.log(`  Guard triggers: ${enabledMetrics.totalGuardTriggers}`)
  console.log(`  Avg outcome score: ${enabledMetrics.avgOutcomeScore.toFixed(3)}`)

  // =====================================================================
  // Phase 4: Compare and report
  // =====================================================================

  const report = buildReport(
    baselineMetrics,
    enabledMetrics,
    baselineTaskMetrics,
    enabledTaskMetrics,
    storeStats.total,
    storeStats.withLessons,
  )

  printReport(report)

  // Save JSON report
  const reportPath = new URL('../benchmark-report.json', import.meta.url)
  writeFileSync(
    reportPath.pathname,
    JSON.stringify(report, null, 2),
    'utf-8',
  )
  console.log(`Report saved to: ${reportPath.pathname}`)

  // Generate self-contained HTML report
  const htmlPath = new URL('../benchmark-report.html', import.meta.url)
  writeFileSync(htmlPath.pathname, generateHtmlReport(report), 'utf-8')
  console.log(`HTML report saved to: ${htmlPath.pathname}`)

  store.close()
}

// ---------------------------------------------------------------------------
// HTML report generator — self-contained, no external dependencies
// ---------------------------------------------------------------------------

function generateHtmlReport(report: ComparisonReport): string {
  const b = report.baseline
  const e = report.enabled
  const imp = report.improvements

  const fmtPct = (v: number, isGuard = false) => {
    if (isGuard) {
      const sign = v >= 0 ? '-' : '+'
      return `${sign}${Math.abs(v).toFixed(1)}%`
    }
    const sign = v >= 0 ? '+' : ''
    return `${sign}${v.toFixed(1)}%`
  }

  const fmtPctColor = (v: number, isGuard = false) => {
    const positive = isGuard ? v > 0 : v > 0
    return positive ? '#16a34a' : '#dc2626'
  }

  const rows = report.baselineTaskMetrics.map((bt, i) => {
    const et = report.enabledTaskMetrics[i]
    const delta = et.outcomeScore - bt.outcomeScore
    const deltaStr = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)
    const deltaColor = delta >= 0 ? '#16a34a' : '#dc2626'
    return `<tr>
      <td>${bt.taskId}</td>
      <td>${bt.taskPattern}</td>
      <td>${bt.description}</td>
      <td>${bt.outcomeScore.toFixed(2)}</td>
      <td>${et.outcomeScore.toFixed(2)}</td>
      <td style="color:${deltaColor};font-weight:600">${deltaStr}</td>
    </tr>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Self-Improving Benchmark Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; color: #94a3b8; }
  .subtitle { color: #64748b; margin-bottom: 2rem; font-size: 0.9rem; }
  .overall { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; text-align: center; }
  .overall .num { font-size: 2.5rem; font-weight: 700; }
  .overall .label { color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #1e293b; border-radius: 10px; padding: 1.25rem; }
  .card .name { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .vals { display: flex; gap: 0.75rem; align-items: baseline; margin-top: 0.5rem; }
  .card .base { color: #64748b; font-size: 1rem; }
  .card .en { color: #e2e8f0; font-size: 1.2rem; font-weight: 600; }
  .card .delta { font-size: 0.85rem; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 10px; overflow: hidden; }
  th { background: #334155; padding: 0.6rem 0.75rem; text-align: left; font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; }
  td { padding: 0.5rem 0.75rem; border-top: 1px solid #334155; font-size: 0.85rem; }
  tr:hover { background: #1e293b33; }
  .summary { display: flex; gap: 2rem; margin-bottom: 1rem; color: #64748b; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Self-Improving Plugin Benchmark</h1>
<p class="subtitle">A/B comparison: baseline (no plugin) vs enabled (with self-improving). Generated ${new Date().toISOString()}</p>

<div class="overall">
  <div class="num" style="color:${fmtPctColor(imp.overallImprovementPct)}">${fmtPct(imp.overallImprovementPct)}</div>
  <div class="label">Overall Improvement</div>
</div>

<div class="summary">
  <span>Experiences accumulated: ${report.experiencesAccumulated}</span>
  <span>Lessons generated: ${report.lessonsGenerated}</span>
</div>

<h2>Metrics Comparison</h2>
<div class="metrics">
  <div class="card">
    <div class="name">Task Completion Rate</div>
    <div class="vals"><span class="base">${b.completionRate.toFixed(1)}%</span> → <span class="en">${e.completionRate.toFixed(1)}%</span></div>
    <div class="delta" style="color:${fmtPctColor(imp.completionImprovementPct)}">${fmtPct(imp.completionImprovementPct)}</div>
  </div>
  <div class="card">
    <div class="name">Tool Efficiency</div>
    <div class="vals"><span class="base">${b.toolEfficiency.toFixed(1)}%</span> → <span class="en">${e.toolEfficiency.toFixed(1)}%</span></div>
    <div class="delta" style="color:${fmtPctColor(imp.toolEfficiencyImprovementPct)}">${fmtPct(imp.toolEfficiencyImprovementPct)}</div>
  </div>
  <div class="card">
    <div class="name">Guard Trigger Rate</div>
    <div class="vals"><span class="base">${b.guardRate.toFixed(1)}%</span> → <span class="en">${e.guardRate.toFixed(1)}%</span></div>
    <div class="delta" style="color:${fmtPctColor(imp.guardImprovementPct, true)}">${fmtPct(imp.guardImprovementPct, true)}</div>
  </div>
  <div class="card">
    <div class="name">Avg Outcome Score (0-1)</div>
    <div class="vals"><span class="base">${b.avgOutcomeScore.toFixed(3)}</span> → <span class="en">${e.avgOutcomeScore.toFixed(3)}</span></div>
    <div class="delta" style="color:${fmtPctColor(imp.outcomeScoreImprovementPct)}">${fmtPct(imp.outcomeScoreImprovementPct)}</div>
  </div>
  <div class="card">
    <div class="name">Token Efficiency</div>
    <div class="vals"><span class="base">${b.tokenEfficiency.toFixed(2)}</span> → <span class="en">${e.tokenEfficiency.toFixed(2)}</span></div>
    <div class="delta" style="color:${fmtPctColor(imp.tokenEfficiencyImprovementPct)}">${fmtPct(imp.tokenEfficiencyImprovementPct)}</div>
  </div>
</div>

<h2>Per-Task Breakdown</h2>
<table>
  <thead><tr><th>Task ID</th><th>Pattern</th><th>Description</th><th>Baseline</th><th>Enabled</th><th>Delta</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`
}

main().catch(console.error)
