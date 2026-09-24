// Task: nextDayUtc(isoDate) returns the following day as 'YYYY-MM-DD'
// (bare ISO date in, UTC arithmetic only).

function nextDayUtc(isoDate) {
  // BUGGY: LOCAL midnight + setDate, read back via toISOString (UTC) — the
  // two-clock mix cancels the increment on non-UTC machines.
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

module.exports = { nextDayUtc }
