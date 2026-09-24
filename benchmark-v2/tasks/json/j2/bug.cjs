// Task: deepClone(obj) returns a DEEP clone for JSON-serializable values:
// mutating the clone at ANY depth must never affect the original.
// Primitives pass through unchanged; functions/undefined are dropped.

function deepClone(obj) {
  // BUGGY: shallow copy — nested objects/arrays are shared with the original.
  return Object.assign({}, obj)
}

module.exports = { deepClone }
