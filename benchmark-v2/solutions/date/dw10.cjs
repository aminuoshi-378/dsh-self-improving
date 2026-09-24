function nextDayUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().slice(0, 10)
}
module.exports = { nextDayUtc }
