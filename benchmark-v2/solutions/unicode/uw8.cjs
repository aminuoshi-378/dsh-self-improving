function lastIndexOfCodePoint(str, ch) {
  const cps = Array.from(str)
  for (let i = cps.length - 1; i >= 0; i--) if (cps[i] === ch) return i
  return -1
}
module.exports = { lastIndexOfCodePoint }
