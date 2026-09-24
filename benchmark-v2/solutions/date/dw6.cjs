function isWeekendUtc(isoDateTime) {
  const day = new Date(isoDateTime).getUTCDay()
  return day === 0 || day === 6
}
module.exports = { isWeekendUtc }
