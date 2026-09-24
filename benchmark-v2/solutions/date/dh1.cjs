function clampedAdd(from, m) {
  const y = from.getUTCFullYear()
  const mo = from.getUTCMonth() + m
  const d = from.getUTCDate()
  const target = new Date(Date.UTC(y, mo, 1))
  const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, dim)))
}
function diffMonthsDays(fromISO, toISO) {
  let a = new Date(fromISO + 'T00:00:00Z')
  let b = new Date(toISO + 'T00:00:00Z')
  let sign = 1
  if (b < a) { const t = a; a = b; b = t; sign = -1 }
  let months = 0
  while (clampedAdd(a, months + 1) <= b) months++
  const days = Math.round((b - clampedAdd(a, months)) / 86400000)
  return { months: sign * months, days: sign * days }
}
module.exports = { diffMonthsDays }
