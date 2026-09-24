// Task: isoWeek(isoDate) -> { year, week } following ISO 8601:
// weeks run Monday-Sunday; week 1 of a year is the week containing that
// year's first Thursday; days before that belong to the previous ISO year
// as its week 52 or 53. A date's ISO year is the calendar year of the
// Thursday of its week.
// isoWeek('2015-12-31') -> { year: 2015, week: 53 }

function isoWeek(isoDate) {
  // BUGGY: day-of-year divided by 7 — ignores the Thursday rule.
  const d = new Date(isoDate + 'T00:00:00Z')
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - start) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

module.exports = { isoWeek }
