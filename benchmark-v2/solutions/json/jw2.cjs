function omit(obj, keys) {
  const out = { ...obj }
  for (const key of keys) delete out[key]
  return out
}
module.exports = { omit }
