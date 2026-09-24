const { nextMondayUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(nextMondayUtc('2026-09-22'), '2026-09-28', 'from tuesday')
eq(nextMondayUtc('2026-09-21'), '2026-09-28', 'already monday: jump to NEXT monday')
eq(nextMondayUtc('2026-09-26'), '2026-09-28', 'from saturday')
eq(nextMondayUtc('2026-09-27'), '2026-09-28', 'from sunday')
eq(nextMondayUtc('2026-12-31'), '2027-01-04', 'crosses the year boundary')
console.log('PASS: nextMondayUtc is strictly-after UTC weekday math')
