function parsePath(path) {
  const steps = []
  let m
  const re = /([^.\[\]]+)|\[(\d+)\]/g
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) steps.push({ k: m[1] })
    else steps.push({ i: Number(m[2]) })
  }
  return steps
}
function getPath(obj, path, fallback) {
  const steps = parsePath(path)
  if (steps === null) return fallback
  let cur = obj
  for (const s of steps) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return fallback
    if (s.i !== undefined) {
      if (!Array.isArray(cur) || s.i < 0 || s.i >= cur.length) return fallback
    } else if (!(s.k in cur)) {
      return fallback
    }
    cur = s.i !== undefined ? cur[s.i] : cur[s.k]
  }
  return cur === undefined ? fallback : cur
}
module.exports = { parsePath, getPath }
