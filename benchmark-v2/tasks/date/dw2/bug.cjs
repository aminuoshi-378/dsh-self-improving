// Task: startOfMonthUtc(isoDate) returns the first day of the month that
// contains the given 'YYYY-MM-DD' date, as 'YYYY-MM-01' (pure UTC).

function startOfMonthUtc(isoDate) {
  // BUGGY: parses at LOCAL midnight, then reads it back via toISOString (UTC),
  // shifting the date on non-UTC machines and producing a garbage month.
  const d = new Date(isoDate + 'T00:00:00')
  return d.toISOString().slice(0, 8) + '01'
}

module.exports = { startOfMonthUtc }
