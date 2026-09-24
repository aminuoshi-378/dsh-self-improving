// Task: codePointValues(str) returns the ARRAY of numeric code point values
// (an emoji is ONE value, e.g. 0x1F600).

function codePointValues(str) {
  // BUGGY: UTF-16 code units — an emoji yields two surrogate values.
  return str.split('').map((c) => c.charCodeAt(0))
}

module.exports = { codePointValues }
