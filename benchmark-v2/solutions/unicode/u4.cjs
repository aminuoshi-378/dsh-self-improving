function ellipsize(str, n) {
  const cps = Array.from(str)
  return cps.length <= n ? str : cps.slice(0, n).join('') + '\u2026'
}
module.exports = { ellipsize }
