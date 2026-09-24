function lastCodePoint(str) {
  const cps = Array.from(str)
  return cps[cps.length - 1]
}
module.exports = { lastCodePoint }
