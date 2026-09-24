// Task: reverse(str) must reverse by Unicode CODE POINTS, not UTF-16 code units.
// reverse('abc') -> 'cba'; reverse('a<emoji>bc') must keep the surrogate pair intact.

function reverse(str) {
  // BUGGY: splits into UTF-16 code units, breaking surrogate pairs (emoji).
  return str.split('').reverse().join('')
}

module.exports = { reverse }
