// Task: getPath(obj, 'a.b.0') walks a dot path and returns the value, or
// undefined for any missing/broken link. It must NEVER throw (even when an
// intermediate value is null or undefined).

function getPath(obj, path) {
  // BUGGY: reduce without a null guard throws on missing intermediates.
  return path.split('.').reduce((acc, key) => acc[key], obj)
}

module.exports = { getPath }
