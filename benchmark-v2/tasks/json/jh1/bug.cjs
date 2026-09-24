// Task: getPath(obj, path, fallback) reads a path with two step kinds:
// '.name' object keys and '[n]' array indices, e.g. 'rows[2].cols[1].v'.
// Every intermediate must exist and be indexable; any missing step,
// out-of-range or negative index, or null/undefined intermediate yields
// fallback. Numbers also work as plain object keys. A final undefined also
// yields fallback.
// getPath({ rows: [{ cols: [{ v: 9 }] }] }, 'rows[0].cols[0].v', 'MISS') -> 9

function getPath(obj, path, fallback) {
  // BUGGY: no bracket parsing, no missing-step guards.
  let cur = obj
  for (const key of path.split('.')) {
    cur = cur[key]
  }
  return cur === undefined ? fallback : cur
}

module.exports = { getPath }
