// Task: lastIndexOfCodePoint(str, ch) returns the CODE POINT INDEX of the
// last occurrence of the single code point ch, or -1 when absent.

function lastIndexOfCodePoint(str, ch) {
  // BUGGY: String.lastIndexOf returns a UTF-16 unit index, which drifts from
  // the code point index whenever earlier multi-unit characters exist.
  return str.lastIndexOf(ch)
}

module.exports = { lastIndexOfCodePoint }
