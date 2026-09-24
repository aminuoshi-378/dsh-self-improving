// Task: swapHalves(str) splits str by CODE POINTS into two halves and swaps
// them. Even count: swap the two halves. Odd count: the middle code point
// stays in place and the halves around it swap.

function swapHalves(str) {
  // BUGGY: halves by UTF-16 length, cutting surrogate pairs and ignoring the
  // keep-middle rule.
  const h = Math.floor(str.length / 2)
  return str.slice(h) + str.slice(0, h)
}

module.exports = { swapHalves }
