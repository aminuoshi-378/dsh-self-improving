// Task: truncate(str, n) must keep the FIRST n CODE POINTS of str.
// truncate('a<emoji>bc', 3) -> 'a<emoji>b' — the emoji counts as ONE and must not be cut in half.

function truncate(str, n) {
  // BUGGY: slices UTF-16 code units; a slice can end inside a surrogate pair.
  return str.slice(0, n)
}

module.exports = { truncate }
