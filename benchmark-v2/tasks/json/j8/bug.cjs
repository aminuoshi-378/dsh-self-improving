// Task: sortByPath(arr, path) sorts ascending by a NESTED dot path value;
// input not mutated.

function sortByPath(arr, path) {
  // BUGGY: reads the path as a single top-level property (dots included),
  // which is always undefined — order never changes.
  return [...arr].sort((x, y) => (x[path] < y[path] ? -1 : x[path] > y[path] ? 1 : 0))
}

module.exports = { sortByPath }
