// Task: addDaysUtc(isoDate, days) adds days to a 'YYYY-MM-DD' date using UTC
// arithmetic and returns 'YYYY-MM-DD'. Month/year boundaries must roll over
// correctly (e.g. '2026-09-30' + 1 -> '2026-10-01').

function addDaysUtc(isoDate, days) {
  // BUGGY: builds the date at LOCAL midnight, then reads it back via toISOString
  // (UTC), which shifts the date by one day on non-UTC machines.
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

module.exports = { addDaysUtc }
