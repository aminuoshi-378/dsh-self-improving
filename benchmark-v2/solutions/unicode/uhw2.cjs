function canonicalKey(s) {
  return s.normalize('NFC').replace(/[\u200B\u200C\u200D\u00AD]/g, '')
}
function sameVisual(a, b) {
  return canonicalKey(a) === canonicalKey(b)
}
module.exports = { sameVisual }
