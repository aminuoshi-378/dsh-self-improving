function daysBetweenUtc(aIso, bIso) {
  return Math.round((Date.parse(bIso) - Date.parse(aIso)) / 86400000)
}
module.exports = { daysBetweenUtc }
