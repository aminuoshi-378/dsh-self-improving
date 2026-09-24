function addDaysUtc(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)
  return new Date(t).toISOString().slice(0, 10)
}
module.exports = { addDaysUtc }
