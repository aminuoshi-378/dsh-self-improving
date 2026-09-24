function nthCodePointValue(str, i) {
  const cps = Array.from(str)
  return i >= 0 && i < cps.length ? cps[i].codePointAt(0) : undefined
}
module.exports = { nthCodePointValue }
