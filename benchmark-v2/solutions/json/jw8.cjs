function sortByKey(arr, key) {
  return [...arr].sort((x, y) => (x[key] < y[key] ? -1 : x[key] > y[key] ? 1 : 0))
}
module.exports = { sortByKey }
