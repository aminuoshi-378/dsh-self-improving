const { isoWeek } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
eqJson(isoWeek('2024-01-01'), { year: 2024, week: 1 }, '2024 starts on its own week 1')
eqJson(isoWeek('2023-01-01'), { year: 2022, week: 52 }, '2023-01-01 is 2022-W52')
eqJson(isoWeek('2016-01-01'), { year: 2015, week: 53 }, 'Friday belongs to a 53-week year')
eqJson(isoWeek('2024-12-30'), { year: 2025, week: 1 }, 'Monday near year end opens 2025-W1')
eqJson(isoWeek('2020-12-31'), { year: 2020, week: 53 }, 'Thursday keeps 2020-W53')
eqJson(isoWeek('2021-01-01'), { year: 2020, week: 53 }, 'Friday stays in previous ISO year')
eqJson(isoWeek('2024-06-15'), { year: 2024, week: 24 }, 'mid-year week')
eqJson(isoWeek('2024-02-29'), { year: 2024, week: 9 }, 'leap-day Thursday is week 9')
console.log('PASS: ISO 8601 week numbering')
