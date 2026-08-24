// Task 5: Fix the string reversal that breaks on multi-char Unicode
// reverse("abc😀def") should return "fed😀cba"
// Currently split('') breaks surrogate pairs

function reverse(str) {
  return str.split('').reverse().join('')
}

module.exports = { reverse }
