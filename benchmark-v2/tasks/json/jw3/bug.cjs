// Task: setPath(obj, path, value) sets a NESTED leaf by dot path, creating
// missing intermediate objects; existing sibling keys survive; must never
// throw on a missing chain.

function setPath(obj, path, value) {
  // BUGGY: reduce without object creation — a missing intermediate throws.
  const keys = path.split('.')
  const target = keys.slice(0, -1).reduce((acc, key) => acc[key], obj)
  target[keys[keys.length - 1]] = value
  return obj
}

module.exports = { setPath }
