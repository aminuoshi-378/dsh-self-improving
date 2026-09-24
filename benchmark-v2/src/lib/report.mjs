import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function readRows(runDir) {
  const file = join(runDir, 'runs.jsonl')
  if (!existsSync(file)) throw new Error(`no runs.jsonl in ${runDir}`)
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

const rate = (passed, total) => (total === 0 ? null : Math.round((passed / total) * 100))
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const fixed = (x) => Math.round(x * 10) / 10

/** Aggregate one run directory into report.json + report.md. */
export function buildReport(runDir) {
  const allRows = readRows(runDir)
  // New protocol rows carry phase train|test; legacy rows warmup|measured map onto it.
  const trainRows = allRows.filter((row) => row.phase === 'train' || row.phase === 'warmup')
  const testRows = allRows.filter((row) => row.phase === 'test' || row.phase === 'measured')

  const byTask = new Map()
  for (const row of testRows) {
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, {})
    byTask.get(row.taskId)[row.arm] = row
  }

  const families = {}
  for (const [taskId, arms] of byTask) {
    const sample = arms.baseline ?? arms.enabled
    const family = families[sample.family] ?? { baseline: { pass: [], durationS: [] }, enabled: { pass: [], durationS: [] } }
    for (const arm of ['baseline', 'enabled']) {
      if (!arms[arm]) continue
      family[arm].pass.push(arms[arm].pass)
      family[arm].durationS.push(arms[arm].durationS)
    }
  }

  const summary = {}
  for (const arm of ['baseline', 'enabled']) {
    const rows = testRows.filter((row) => row.arm === arm)
    summary[arm] = {
      tasks: rows.length,
      passed: rows.filter((r) => r.pass).length,
      passRate: rate(rows.filter((r) => r.pass).length, rows.length),
      meanDurationS: fixed(mean(rows.map((r) => r.durationS))),
    }
  }
  const negativeTransfer = [...byTask.entries()]
    .filter(([, arms]) => arms.baseline?.pass && arms.enabled && !arms.enabled.pass)
    .map(([taskId]) => taskId)
  const positiveOnly = [...byTask.entries()]
    .filter(([, arms]) => arms.enabled?.pass && arms.baseline && !arms.baseline.pass)
    .map(([taskId]) => taskId)

  const report = {
    generatedAt: new Date().toISOString(),
    runDir,
    summary,
    negativeTransfer,
    positiveOnly,
    training: {
      tasks: trainRows.length,
      passed: trainRows.filter((r) => r.pass).length,
      list: trainRows.map((r) => ({ taskId: r.taskId, pass: r.pass, durationS: r.durationS })),
    },
    families,
    tasks: [...byTask.entries()].map(([taskId, arms]) => ({
      taskId,
      family: (arms.baseline ?? arms.enabled).family,
      baseline: arms.baseline ? { pass: arms.baseline.pass, durationS: arms.baseline.durationS } : null,
      enabled: arms.enabled ? { pass: arms.enabled.pass, durationS: arms.enabled.durationS } : null,
      durationDeltaS: arms.baseline && arms.enabled ? fixed(arms.enabled.durationS - arms.baseline.durationS) : null,
    })),
  }
  writeFileSync(join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const lines = [
    `# benchmark-v2 report — ${runDir}`,
    '',
    '## Test-set comparison (same tasks, both arms)',
    '',
    `- baseline: ${summary.baseline.passed}/${summary.baseline.tasks} passed (${summary.baseline.passRate ?? '-'}%), mean ${summary.baseline.meanDurationS}s`,
    `- enabled:  ${summary.enabled.passed}/${summary.enabled.tasks} passed (${summary.enabled.passRate ?? '-'}%), mean ${summary.enabled.meanDurationS}s`,
    `- negative transfer (enabled fails where baseline passed): ${negativeTransfer.length ? negativeTransfer.join(', ') : 'none'}`,
    `- enabled-only passes: ${positiveOnly.length ? positiveOnly.join(', ') : 'none'}`,
    '',
    '## Per-task',
    '',
    '| task | family | baseline | enabled | duration delta (s) |',
    '|---|---|---|---|---|',
  ]
  for (const task of report.tasks) {
    const fmt = (side) => (side ? (side.pass ? 'PASS' : 'FAIL') : '-')
    const d = task.durationDeltaS === null ? '-' : (task.durationDeltaS > 0 ? '+' : '') + task.durationDeltaS
    lines.push(`| ${task.taskId} | ${task.family} | ${fmt(task.baseline)} | ${fmt(task.enabled)} | ${d} |`)
  }
  lines.push('', '## Per-family (test set)', '', '| family | baseline pass | enabled pass | baseline mean (s) | enabled mean (s) |', '|---|---|---|---|---|')
  for (const [family, agg] of Object.entries(families)) {
    const bp = `${agg.baseline.pass.filter(Boolean).length}/${agg.baseline.pass.length}`
    const ep = `${agg.enabled.pass.filter(Boolean).length}/${agg.enabled.pass.length}`
    lines.push(`| ${family} | ${bp} | ${ep} | ${fixed(mean(agg.baseline.durationS))} | ${fixed(mean(agg.enabled.durationS))} |`)
  }
  lines.push('', '## Training phase (enabled arm only)', '')
  if (trainRows.length) {
    lines.push(`Pass ${report.training.passed}/${report.training.tasks}, mean ${fixed(mean(trainRows.map((r) => r.durationS)))}s`, '', '| task | pass | duration (s) |', '|---|---|---|')
    for (const row of trainRows) lines.push(`| ${row.taskId} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.durationS} |`)
  } else {
    lines.push('(no training rows in this run)')
  }
  writeFileSync(join(runDir, 'report.md'), `${lines.join('\n')}\n`)
  return report
}
