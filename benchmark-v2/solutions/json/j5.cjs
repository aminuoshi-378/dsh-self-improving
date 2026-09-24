function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function mergeDeep(a, b) {
  const out = { ...a }
  for (const [key, value] of Object.entries(b)) {
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? mergeDeep(out[key], value) : value
  }
  return out
}
module.exports = { mergeDeep }
