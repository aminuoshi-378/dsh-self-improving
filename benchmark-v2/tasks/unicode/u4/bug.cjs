// Task: ellipsize(str, n) — if str fits within n CODE POINTS return it unchanged,
// otherwise return the first n code points followed by a single '…' character.
// Never cut a surrogate pair in half, and the threshold counts code points.

function ellipsize(str, n) {
  // BUGGY: uses UTF-16 length for the fit check and UTF-16 slicing for the cut.
  return str.length <= n ? str : str.slice(0, n) + '\u2026'
}

module.exports = { ellipsize }
