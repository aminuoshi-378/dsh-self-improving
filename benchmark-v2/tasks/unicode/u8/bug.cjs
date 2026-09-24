// Task: replaceCodePointAt(str, i, repl) replaces the i-th CODE POINT with
// repl (repl may itself be an emoji); out-of-range i leaves str unchanged.

function replaceCodePointAt(str, i, repl) {
  // BUGGY: UTF-16 splicing cuts surrounding surrogate pairs.
  if (i < 0 || i >= str.length) return str
  return str.slice(0, i) + repl + str.slice(i + 1)
}

module.exports = { replaceCodePointAt }
