// Task: diffMonthsDays(fromISO, toISO) -> { months, days }. Both dates are
// UTC midnight. months is the LARGEST integer m such that clampedAdd(from, m)
// is <= to, where clampedAdd advances m calendar months and clamps the day
// to the target month's length (Jan 31 + 1 month = Feb 29 in a leap year).
// days is the whole-day distance from clampedAdd(from, months) to to.
// When to < from, compute on the swapped pair and negate both numbers.
// diffMonthsDays('2024-01-31', '2024-03-01') -> { months: 1, days: 1 }

function diffMonthsDays(fromISO, toISO) {
  // BUGGY: month arithmetic without day clamping and a raw day count.
  const from = new Date(fromISO + 'T00:00:00Z')
  const to = new Date(toISO + 'T00:00:00Z')
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth())
  const days = Math.round((to - from) / 86400000)
  return { months, days }
}

module.exports = { diffMonthsDays }
