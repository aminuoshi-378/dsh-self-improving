const { daysBetweenUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(daysBetweenUtc('2026-01-01', '2026-01-02'), 1, 'adjacent days')
eq(daysBetweenUtc('2026-01-01', '2026-03-01'), 59, 'jan 1 -> mar 1 is 59 days in 2026 (feb has 28)')
eq(daysBetweenUtc('2026-02-28', '2026-03-01'), 1, 'feb 28 -> mar 1')
eq(daysBetweenUtc('2025-12-31', '2026-01-01'), 1, 'year boundary')
eq(daysBetweenUtc('2026-09-22', '2027-09-22'), 365, 'one non-leap year later')
console.log('PASS: daysBetweenUtc is exact UTC day math')
