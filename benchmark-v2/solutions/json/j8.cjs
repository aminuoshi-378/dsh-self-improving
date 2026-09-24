function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}
function sortByPath(arr, path) {
  return [...arr].sort((x, y) => {
    const a = getByPath(x, path)
    const b = getByPath(y, path)
    return a < b ? -1 : a > b ? 1 : 0
  })
}
module.exports = { sortByPath }
