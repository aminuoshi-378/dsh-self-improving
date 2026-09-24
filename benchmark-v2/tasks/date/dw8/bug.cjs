// Task: isoWeekdayUtc(isoDateTime) returns the UTC weekday as 0-6
// (0 = Sunday), never the local weekday.

function isoWeekdayUtc(isoDateTime) {
  // BUGGY: local getDay drifts near midnight on non-UTC machines.
  return new Date(isoDateTime).getDay()
}

module.exports = { isoWeekdayUtc }
