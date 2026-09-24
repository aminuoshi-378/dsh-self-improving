const { quarterStartUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(quarterStartUtc('2026-02-15'), '2026-01-01', 'q1')
eq(quarterStartUtc('2026-11-15'), '2026-10-01', 'q4')
eq(quarterStartUtc('2026-04-01'), '2026-04-01', 'already quarter start')
eq(quarterStartUtc('2025-12-31'), '2025-10-01', 'q4 of previous year')
console.log('PASS: quarterStartUtc pads months and uses UTC')
