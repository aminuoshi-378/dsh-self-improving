// Task: firstCodePoint(str) returns the FIRST Unicode code point of str as
// a string (an emoji is ONE code point and must stay whole).

function firstCodePoint(str) {
  // BUGGY: indexes UTF-16 code units; an emoji yields a lone surrogate half.
  return str[0]
}

module.exports = { firstCodePoint }
