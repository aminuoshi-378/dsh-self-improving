function reverseWords(str) {
  return str.split(' ').map((w) => Array.from(w).reverse().join('')).join(' ')
}
module.exports = { reverseWords }
