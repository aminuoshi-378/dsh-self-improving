function getPath(obj, path, fallback) {
  const steps = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let m
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) steps.push(m[1])
    else steps.push(Number(m[2]))
  }
  let cur = obj
  for (const s of steps) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return fallback
    if (Array.isArray(cur)) {
      if (typeof s !== 'number' || s < 0 || s >= cur.length) return fallback
    } else if (!(s in cur)) {
      return fallback
    }
    cur = cur[s]
  }
  return cur === undefined ? fallback : cur
}
module.exports = { getPath }
