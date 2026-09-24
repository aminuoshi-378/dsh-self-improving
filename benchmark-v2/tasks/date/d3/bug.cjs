// Task: daysBetweenUtc(aIso, bIso) returns the exact number of whole UTC days
// between two 'YYYY-MM-DD' dates (b >= a). Real month lengths matter
// (February is not 30 days).

function daysBetweenUtc(aIso, bIso) {
  const a = new Date(aIso + 'T00:00:00Z')
  const b = new Date(bIso + 'T00:00:00Z')
  // BUGGY: approximates every month as 30 days.
  return (b.getUTCDate() - a.getUTCDate())
    + 30 * (b.getUTCMonth() - a.getUTCMonth())
    + 365 * (b.getUTCFullYear() - a.getUTCFullYear())
}

module.exports = { daysBetweenUtc }
