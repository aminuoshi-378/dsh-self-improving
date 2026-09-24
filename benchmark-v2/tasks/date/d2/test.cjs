const { addDaysUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(addDaysUtc('2026-09-22', 0), '2026-09-22', 'zero days: identity')
eq(addDaysUtc('2026-09-22', 1), '2026-09-23', 'simple add')
eq(addDaysUtc('2026-09-30', 1), '2026-10-01', 'month rollover')
eq(addDaysUtc('2026-12-31', 1), '2027-01-01', 'year rollover')
eq(addDaysUtc('2026-01-31', 1), '2026-02-01', 'jan 31 -> feb 1')
eq(addDaysUtc('2026-09-22', -1), '2026-09-21', 'negative days')
console.log('PASS: addDaysUtc uses pure UTC day arithmetic')
