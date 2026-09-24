const { addBusinessDays } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(addBusinessDays('2024-06-07', 1), '2024-06-10', 'Friday + 1 skips weekend')
eq(addBusinessDays('2024-06-08', 1), '2024-06-10', 'Saturday + 1 lands Monday')
eq(addBusinessDays('2024-06-09', 1), '2024-06-10', 'Sunday + 1 lands Monday')
eq(addBusinessDays('2024-06-10', 5), '2024-06-17', 'Monday + 5 is next Monday')
eq(addBusinessDays('2024-06-12', 10), '2024-06-26', 'Wednesday + 10 across two weekends')
eq(addBusinessDays('2024-06-10', -5), '2024-06-03', 'Monday - 5 is previous Monday')
eq(addBusinessDays('2024-06-11', 0), '2024-06-11', 'zero is unchanged')
eq(addBusinessDays('2024-06-11', -1), '2024-06-10', 'negative one')
console.log('PASS: business-day arithmetic skips weekends')
