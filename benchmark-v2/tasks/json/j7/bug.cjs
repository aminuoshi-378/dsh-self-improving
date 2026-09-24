// Task: deletePath(obj, path) returns a COPY with the dot-path leaf removed;
// a missing path returns an unchanged copy; the input is never mutated.

function deletePath(obj, path) {
  // BUGGY: mutates the original object.
  const keys = path.split('.')
  const target = keys.slice(0, -1).reduce((acc, key) => acc[key], obj)
  delete target[keys[keys.length - 1]]
  return obj
}

module.exports = { deletePath }
