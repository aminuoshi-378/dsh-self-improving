function substringByCodePoints(str, start, end) {
  const cps = Array.from(str)
  return cps.slice(Math.max(0, start), Math.min(cps.length, end)).join('')
}
module.exports = { substringByCodePoints }
