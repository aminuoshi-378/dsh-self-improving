// shift.js — UTC date arithmetic (ISO strings in, ISO strings out).
// test.cjs is the complete behavioral contract for this workspace.
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function addMonthsClamped(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())).toISOString().slice(0, 10)
}
function startOfWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  const dow = d.getUTCDay()
  return addDays(iso, -dow)
}
module.exports = { addDays, addMonthsClamped, startOfWeek }
