function groupBy(arr, key) {
  const out = {}
  for (const item of arr) (out[item[key]] ??= []).push(item)
  return out
}
module.exports = { groupBy }
