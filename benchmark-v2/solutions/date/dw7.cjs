function daysUntilUtc(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000)
}
module.exports = { daysUntilUtc }
