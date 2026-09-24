function swapHalves(str) {
  const cps = Array.from(str)
  const mid = Math.floor(cps.length / 2)
  if (cps.length % 2 === 0) {
    return cps.slice(mid).join('') + cps.slice(0, mid).join('')
  }
  return cps.slice(mid + 1).join('') + cps[mid] + cps.slice(0, mid).join('')
}
module.exports = { swapHalves }
