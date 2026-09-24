// Task: deepEqualJson(a, b) tells whether two JSON values are structurally
// equal IGNORING object key order (arrays keep order).

function deepEqualJson(a, b) {
  // BUGGY: plain stringify comparison — key order changes the verdict.
  return JSON.stringify(a) === JSON.stringify(b)
}

module.exports = { deepEqualJson }
