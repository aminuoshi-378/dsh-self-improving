// Task: sortByKey(arr, key) returns a NEW array sorted ascending by the string
// value of each item's `key`; the input must not be mutated.

function sortByKey(arr, key) {
  // BUGGY: default sort ignores the key AND mutates in place.
  return arr.sort()
}

module.exports = { sortByKey }
