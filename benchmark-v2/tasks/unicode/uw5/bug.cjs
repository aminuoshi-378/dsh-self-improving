// Task: removeAt(str, i) removes the i-th CODE POINT; out-of-range i leaves
// the string unchanged; surrogate pairs must never be cut in half.

function removeAt(str, i) {
  // BUGGY: UTF-16 slicing cuts surrogate pairs.
  if (i < 0 || i >= str.length) return str
  return str.slice(0, i) + str.slice(i + 1)
}

module.exports = { removeAt }
