// Task: endOfMonthUtc(isoDate) returns the LAST day of the date's own month
// as 'YYYY-MM-DD' (real month lengths, UTC only).

function endOfMonthUtc(isoDate) {
  // BUGGY: sets day 31 on a LOCAL-midnight date — months with fewer days roll
  // over, and the local->UTC readback shifts the result.
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(31)
  return d.toISOString().slice(0, 10)
}

module.exports = { endOfMonthUtc }
