// Task: unflatten(flat) inverts dot-key flattening. A node whose child keys
// are ALL numeric (like 'c.0', 'c.1') must be restored as an ARRAY, not an
// object: {'user.name':'x','tags.0':'a','tags.1':'b'}
//   -> { user:{name:'x'}, tags:['a','b'] }

function unflatten(flat) {
  const root = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      // BUGGY: every intermediate node becomes a plain object, even when all
      // its children are numeric indices.
      node[part] = node[part] || {}
      node = node[part]
    }
    node[parts[parts.length - 1]] = value
  }
  return root
}

module.exports = { unflatten }
