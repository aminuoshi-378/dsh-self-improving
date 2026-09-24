function prevMonthEndUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)
  return new Date(t).toISOString().slice(0, 10)
}
module.exports = { prevMonthEndUtc }
