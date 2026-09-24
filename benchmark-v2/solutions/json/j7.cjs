function deletePath(obj, path) {
  const out = structuredClone(obj)
  const keys = path.split('.')
  const target = keys.slice(0, -1).reduce((acc, key) => (acc == null ? undefined : acc[key]), out)
  if (target != null) delete target[keys[keys.length - 1]]
  return out
}
module.exports = { deletePath }
