function invert(obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj)) out[value] = key
  return out
}
module.exports = { invert }
