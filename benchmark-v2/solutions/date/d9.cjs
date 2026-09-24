function utcPartsFromEpoch(epochMs) {
  const d = new Date(epochMs)
  const p = (n) => String(n).padStart(2, '0')
  return [String(d.getUTCFullYear()), p(d.getUTCMonth() + 1), p(d.getUTCDate()), p(d.getUTCHours()), p(d.getUTCMinutes()), p(d.getUTCSeconds())]
}
module.exports = { utcPartsFromEpoch }
