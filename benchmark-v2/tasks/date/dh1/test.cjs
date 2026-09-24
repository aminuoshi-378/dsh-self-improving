const { diffMonthsDays } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
eqJson(diffMonthsDays('2024-01-30', '2024-02-29'), { months: 1, days: 0 }, 'day-30 clamps to Feb 29')
eqJson(diffMonthsDays('2023-01-31', '2023-03-01'), { months: 1, days: 1 }, 'non-leap clamp to Feb 28')
eqJson(diffMonthsDays('2024-05-31', '2024-07-01'), { months: 1, days: 1 }, '31st clamps to Jun 30')
eqJson(diffMonthsDays('2024-03-31', '2024-03-15'), { months: 0, days: -16 }, 'same month, negative days')
eqJson(diffMonthsDays('2024-01-15', '2024-03-10'), { months: 1, days: 24 }, 'one month plus remainder')
eqJson(diffMonthsDays('2023-02-28', '2024-02-29'), { months: 12, days: 1 }, 'across a leap boundary')
console.log('PASS: calendar distance with clamping (held-out)')
