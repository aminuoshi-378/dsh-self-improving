const { startOfMonthUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(startOfMonthUtc('2026-09-15'), '2026-09-01', 'september')
eq(startOfMonthUtc('2026-01-31'), '2026-01-01', 'january')
eq(startOfMonthUtc('2025-12-05'), '2025-12-01', 'december')
eq(startOfMonthUtc('2026-03-01'), '2026-03-01', 'already the first')
console.log('PASS: startOfMonthUtc is pure UTC month math')
