// Task: flatten(obj, prefix = '') flattens nested plain objects into a
// single-level object whose keys join with '.'. A plain object is a non-null
// object that is NOT an array; arrays and primitives stay as leaf values.
// A cycle anywhere in the tree must throw Error('CIRCULAR'). The prefix
// prepends to every output key.
// flatten({ a: { b: { c: 1 } }, d: [1, 2] }) -> { 'a.b.c': 1, d: [1, 2] }
// flatten({ a: 5 }, 'x') -> { 'x.a': 5 }

function flatten(obj, prefix = '') {
  // BUGGY: expands arrays too and has no cycle guard.
  const out = {}
  const walk = (node, pre) => {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'object' && v !== null) walk(v, pre ? `${pre}.${k}` : k)
      else out[pre ? `${pre}.${k}` : k] = v
    }
  }
  walk(obj, prefix)
  return out
}

module.exports = { flatten }
