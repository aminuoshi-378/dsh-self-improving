function setPath(obj, path, value) {
  const keys = path.split('.')
  let node = obj
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys[keys.length - 1]] = value
  return obj
}
module.exports = { setPath }
