// Task: countCodePoints(str) must return the number of Unicode CODE POINTS, not UTF-16 units.
// countCodePoints('a<emoji>b') -> 3 (the emoji is ONE code point despite being 2 UTF-16 units).

function countCodePoints(str) {
  // BUGGY: .length counts UTF-16 code units.
  return str.length
}

module.exports = { countCodePoints }
