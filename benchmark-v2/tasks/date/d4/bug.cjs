// Task: nextMondayUtc(isoDate) returns the ISO date of the next Monday STRICTLY
// AFTER the given 'YYYY-MM-DD' date. If the date is already a Monday, the
// answer is the Monday one week later (never the same day).

function nextMondayUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const day = d.getUTCDay()
  // BUGGY: for a Monday (day===1) the delta is 0, returning the SAME date.
  const delta = (8 - day) % 7
  return new Date(d.getTime() + delta * 86400000).toISOString().slice(0, 10)
}

module.exports = { nextMondayUtc }
