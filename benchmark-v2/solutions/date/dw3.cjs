function endOfMonthUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}
module.exports = { endOfMonthUtc }
