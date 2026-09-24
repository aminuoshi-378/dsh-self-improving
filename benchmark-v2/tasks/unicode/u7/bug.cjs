// Task: substringByCodePoints(str, start, end) returns code points [start, end)
// (start inclusive, end exclusive, both counted in CODE POINTS; clamped).

function substringByCodePoints(str, start, end) {
  // BUGGY: UTF-16 slicing cuts surrogate pairs and counts units.
  return str.slice(start, end)
}

module.exports = { substringByCodePoints }
