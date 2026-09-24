// Task: stableStringify(obj) serializes like JSON.stringify but with object
// keys SORTED (recursively), so two objects that differ only in key order
// produce the IDENTICAL string.

function stableStringify(obj) {
  // BUGGY: plain JSON.stringify keeps insertion order.
  return JSON.stringify(obj)
}

module.exports = { stableStringify }
