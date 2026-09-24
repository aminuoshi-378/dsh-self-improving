function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function addMonthsClamped(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), dim))).toISOString().slice(0, 10)
}
function startOfWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1
  return addDays(iso, 1 - isoDow)
}
module.exports = { addDays, addMonthsClamped, startOfWeek }
