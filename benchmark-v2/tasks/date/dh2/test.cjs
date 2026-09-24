const { addBusinessDays } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(addBusinessDays('2024-05-31', 3), '2024-06-05', 'Friday across month boundary')
eq(addBusinessDays('2024-12-30', 5), '2025-01-06', 'across the year boundary')
eq(addBusinessDays('2024-06-12', -10), '2024-05-29', 'negative ten business days')
eq(addBusinessDays('2024-06-16', 2), '2024-06-18', 'Sunday start counts forward')
eq(addBusinessDays('2025-03-01', 1), '2025-03-03', 'Saturday in March 2025')
eq(addBusinessDays('2024-06-07', 2), '2024-06-11', 'Friday + 2')
eq(addBusinessDays('2024-06-07', -1), '2024-06-06', 'Friday - 1 is Thursday')
console.log('PASS: business days across boundaries (held-out)')
