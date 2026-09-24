function unflatten(flat) {
  const root = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!node[part]) node[part] = {}
      node = node[part]
    }
    node[parts[parts.length - 1]] = value
  }
  const fix = (node) => {
    if (node === null || typeof node !== 'object') return node
    const keys = Object.keys(node)
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      return keys.map((k) => fix(node[k]))
    }
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = fix(v)
    return out
  }
  return fix(root)
}
module.exports = { unflatten }
