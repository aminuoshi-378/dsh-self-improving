// Task: isWeekendUtc(isoDateTime) tells whether the instant is a UTC Saturday
// or Sunday.

function isWeekendUtc(isoDateTime) {
  // BUGGY: reads the LOCAL weekday; on a non-UTC machine the answer drifts
  // near midnight.
  const day = new Date(isoDateTime).getDay()
  return day === 0 || day === 6
}

module.exports = { isWeekendUtc }
