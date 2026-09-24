// Task: reverseWords(str) reverses the CODE POINTS inside each space-separated
// word while keeping the word ORDER untouched. Emoji inside words must stay
// whole.

function reverseWords(str) {
  // BUGGY: splits words into UTF-16 units, breaking surrogate pairs.
  return str.split(' ').map((w) => w.split('').reverse().join('')).join(' ')
}

module.exports = { reverseWords }
