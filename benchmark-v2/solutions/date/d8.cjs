function daysInMonthUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
module.exports = { daysInMonthUtc }
