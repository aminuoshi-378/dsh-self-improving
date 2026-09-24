// Task: zipStrings(a, b) interleaves the two strings CODE POINT by code
// point (a's first, b's first, a's second, ...); leftovers append at the end.

function zipStrings(a, b) {
  // BUGGY: walks UTF-16 indices, splitting surrogate pairs.
  let out = ''
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out += a[i]
    if (i < b.length) out += b[i]
  }
  return out
}

module.exports = { zipStrings }
