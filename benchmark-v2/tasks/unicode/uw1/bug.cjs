// Task: lastCodePoint(str) must return the LAST Unicode code point of str
// as a string (an emoji is ONE code point even though it is 2 UTF-16 units).

function lastCodePoint(str) {
  // BUGGY: indexes UTF-16 code units; for an emoji this returns a lone
  // (broken) surrogate half.
  return str[str.length - 1]
}

module.exports = { lastCodePoint }
