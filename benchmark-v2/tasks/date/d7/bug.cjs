// Task: firstDayNextMonthUtc(isoDate) returns the first day of the month AFTER
// the date's month, as 'YYYY-MM-01' (UTC, year rollover must work).

function firstDayNextMonthUtc(isoDate) {
  // BUGGY: raw month+1 with no zero padding and no year rollover.
  const d = new Date(isoDate + 'T00:00:00Z')
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 2}-01`
}

module.exports = { firstDayNextMonthUtc }
