// Task: flattenPaths(obj) returns the SORTED array of dot paths to every
// primitive leaf (recursing into plain objects only; arrays are leaves).

function flattenPaths(obj) {
  // BUGGY: top-level keys only, no recursion.
  return Object.keys(obj)
}

module.exports = { flattenPaths }
