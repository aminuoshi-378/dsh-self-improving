// Task: reverse(str) must reverse by USER-PERCEIVED characters (grapheme
// clusters): combining-mark chains, regional-indicator (flag) pairs, and
// ZWJ sequences (emoji families) each move as one unit.
// reverse('q\u0323\u0307a') -> 'aq\u0323\u0307'
// (the two combining marks stay attached to their base letter)

function reverse(str) {
  // BUGGY: reverses by code points. Combining chains detach, flags and
  // ZWJ families scramble.
  return Array.from(str).reverse().join('')
}

module.exports = { reverse }
