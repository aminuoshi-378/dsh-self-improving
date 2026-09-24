const { diffMonthsDays } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
eqJson(diffMonthsDays('2024-01-15', '2024-03-15'), { months: 2, days: 0 }, 'exact months')
eqJson(diffMonthsDays('2024-01-31', '2024-03-01'), { months: 1, days: 1 }, 'clamp to Feb 29')
eqJson(diffMonthsDays('2024-02-29', '2025-02-28'), { months: 12, days: 0 }, 'leap day clamps to Feb 28')
eqJson(diffMonthsDays('2023-12-31', '2024-01-01'), { months: 0, days: 1 }, 'under one month')
eqJson(diffMonthsDays('2024-03-01', '2024-01-31'), { months: -1, days: -1 }, 'negated swap')
eqJson(diffMonthsDays('2024-01-01', '2024-01-01'), { months: 0, days: 0 }, 'same day')
eqJson(diffMonthsDays('2024-06-15', '2024-02-15'), { months: -4, days: 0 }, 'negative exact months')
console.log('PASS: calendar month/day distance with clamping')
