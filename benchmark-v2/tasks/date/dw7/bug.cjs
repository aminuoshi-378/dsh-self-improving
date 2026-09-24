// Task: daysUntilUtc(fromIso, toIso) returns the whole UTC days from one bare
// ISO date to the other (to >= from).

function daysUntilUtc(fromIso, toIso) {
  // BUGGY: month arithmetic with a 30-day approximation.
  const a = new Date(fromIso + 'T00:00:00Z')
  const b = new Date(toIso + 'T00:00:00Z')
  return (b.getUTCDate() - a.getUTCDate()) + 30 * (b.getUTCMonth() - a.getUTCMonth()) + 365 * (b.getUTCFullYear() - a.getUTCFullYear())
}

module.exports = { daysUntilUtc }
