function removeAt(str, i) {
  const cps = Array.from(str)
  if (i < 0 || i >= cps.length) return str
  cps.splice(i, 1)
  return cps.join('')
}
module.exports = { removeAt }
