// Task: nthCodePointValue(str, i) returns the numeric code point VALUE of the
// i-th code point (emoji is ONE code point worth U+1F600 = 0x1F600), or
// undefined when i is out of range.

function nthCodePointValue(str, i) {
  // BUGGY: charCodeAt reads UTF-16 code units; for an emoji it returns a lone
  // surrogate value (0xD83D), not the code point value.
  return str.charCodeAt(i)
}

module.exports = { nthCodePointValue }
