// Task: getPath(obj, path, fallback) reads a path with two step kinds:
// '.name' object keys and '[n]' array indices, e.g. 'a.b', 'items[2].x',
// 'm[1][0]'. Every intermediate must exist and be indexable; any missing
// step, out-of-range or negative index, or null/undefined intermediate
// yields fallback. Numbers also work as plain object keys ('k0.0' style).
// The final value being undefined also yields fallback.
// getPath({ items: [{ x: 7 }] }, 'items[0].x', 'MISS') -> 7
// getPath({}, 'a.b', 'MISS') -> 'MISS'

function getPath(obj, path, fallback) {
  // BUGGY: no bracket parsing, no missing-step guards.
  let cur = obj
  for (const key of path.split('.')) {
    cur = cur[key]
  }
  return cur === undefined ? fallback : cur
}

module.exports = { getPath }
