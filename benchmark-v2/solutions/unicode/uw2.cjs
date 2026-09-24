function insertAt(str, index, insertion) {
  const cps = Array.from(str)
  cps.splice(Math.min(index, cps.length), 0, ...Array.from(insertion))
  return cps.join('')
}
module.exports = { insertAt }
