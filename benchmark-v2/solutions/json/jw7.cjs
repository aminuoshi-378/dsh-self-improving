function uniqueByKey(arr, key) {
  const seen = new Set()
  const out = []
  for (const item of arr) {
    if (seen.has(item[key])) continue
    seen.add(item[key])
    out.push(item)
  }
  return out
}
module.exports = { uniqueByKey }
