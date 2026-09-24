const { isoWeek } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
eqJson(isoWeek('2015-12-31'), { year: 2015, week: 53 }, 'Thursday ends a 53-week year')
eqJson(isoWeek('2000-01-01'), { year: 1999, week: 52 }, '2000-01-01 is Saturday of 1999-W52')
eqJson(isoWeek('2005-01-01'), { year: 2004, week: 53 }, '2005-01-01 is Saturday of 2004-W53')
eqJson(isoWeek('2006-01-01'), { year: 2005, week: 52 }, '2006-01-01 is Sunday of 2005-W52')
eqJson(isoWeek('2025-12-29'), { year: 2026, week: 1 }, 'Monday opens 2026-W1')
eqJson(isoWeek('2024-12-31'), { year: 2025, week: 1 }, 'Tuesday stays with 2025-W1')
eqJson(isoWeek('2024-07-04'), { year: 2024, week: 27 }, 'ordinary Thursday')
console.log('PASS: ISO week edges (held-out)')
