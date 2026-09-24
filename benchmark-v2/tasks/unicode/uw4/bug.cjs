// Task: isNonBmpAt(str, i) tells whether the i-th CODE POINT is outside the
// Basic Multilingual Plane (value >= 0x10000, e.g. emoji).

function isNonBmpAt(str, i) {
  // BUGGY: charCodeAt reads UTF-16 code units and never exceeds 0xFFFF.
  return str.charCodeAt(i) > 0xFFFF
}

module.exports = { isNonBmpAt }
