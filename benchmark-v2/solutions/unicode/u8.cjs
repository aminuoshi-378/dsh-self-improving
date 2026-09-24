function replaceCodePointAt(str, i, repl) {
  const cps = Array.from(str)
  if (i < 0 || i >= cps.length) return str
  cps.splice(i, 1, ...Array.from(repl))
  return cps.join('')
}
module.exports = { replaceCodePointAt }
