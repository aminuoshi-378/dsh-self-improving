// Task: reverse(str) must reverse by USER-PERCEIVED characters (grapheme
// clusters): combining-mark sequences (e + U+0301), regional-indicator pairs
// (flags), and ZWJ sequences (emoji families) must each move as one unit.
// reverse('e\u0301x') -> 'xe\u0301'; reverse('\u{1F1FA}\u{1F1F8}') -> itself.

function reverse(str) {
  // BUGGY: reverses by code points. Combining marks detach from their base,
  // flag pairs scramble, ZWJ families split.
  return Array.from(str).reverse().join('')
}

module.exports = { reverse }
