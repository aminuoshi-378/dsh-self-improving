function flatten(obj, prefix = '') {
  const out = {}
  const path = []
  const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  const walk = (node, pre) => {
    if (isPlain(node)) {
      if (path.includes(node)) throw new Error('CIRCULAR')
      path.push(node)
      for (const [k, v] of Object.entries(node)) walk(v, pre ? `${pre}.${k}` : k)
      path.pop()
    } else {
      out[pre] = node
    }
  }
  walk(obj, prefix)
  return out
}
module.exports = { flatten }
