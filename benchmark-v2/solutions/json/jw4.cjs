function pick(obj, keys) {
  const out = {}
  for (const key of keys) if (key in obj) out[key] = obj[key]
  return out
}
module.exports = { pick }
