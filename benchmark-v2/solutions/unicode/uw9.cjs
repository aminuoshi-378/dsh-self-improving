function takeWhileBmp(str) {
  const cps = Array.from(str)
  const kept = []
  for (const cp of cps) {
    if (cp.codePointAt(0) >= 0x10000) break
    kept.push(cp)
  }
  return kept.join('')
}
module.exports = { takeWhileBmp }
