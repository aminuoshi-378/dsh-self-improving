function walk(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) walk(value, path, out)
    else out.push(path)
  }
}
function flattenPaths(obj) { const out = []; walk(obj, '', out); return out.sort() }
module.exports = { flattenPaths }
