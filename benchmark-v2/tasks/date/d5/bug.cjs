// Task: prevMonthEndUtc(isoDate) returns the LAST day of the month BEFORE the
// given date's month, as 'YYYY-MM-DD' (real month lengths, UTC).

function prevMonthEndUtc(isoDate) {
  // BUGGY: subtracts a fixed 30 days from a LOCAL-midnight date and reads it
  // back as UTC — both the fixed length and the local/UTC mix are wrong.
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

module.exports = { prevMonthEndUtc }
