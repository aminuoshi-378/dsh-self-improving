function startOfMonthUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  return d.toISOString().slice(0, 8) + '01'
}
module.exports = { startOfMonthUtc }
