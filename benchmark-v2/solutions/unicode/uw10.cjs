function zipStrings(a, b) {
  const x = Array.from(a)
  const y = Array.from(b)
  const out = []
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (i < x.length) out.push(x[i])
    if (i < y.length) out.push(y[i])
  }
  return out.join('')
}
module.exports = { zipStrings }
