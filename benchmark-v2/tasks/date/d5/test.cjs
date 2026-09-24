const { prevMonthEndUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(prevMonthEndUtc('2026-03-15'), '2026-02-28', 'february ends on the 28th')
eq(prevMonthEndUtc('2026-01-15'), '2025-12-31', 'january looks back to december')
eq(prevMonthEndUtc('2026-07-04'), '2026-06-30', 'june has 30 days')
eq(prevMonthEndUtc('2025-03-01'), '2025-02-28', 'non-leap february')
console.log('PASS: prevMonthEndUtc uses real month lengths')
