// paths.js — path parsing and reads.
// test.cjs is the complete behavioral contract for this workspace.
function parsePath(path) {
  // indices slip through as names.
  const steps = []
  let m
  const re = /([^.\[\]]+)|\[([^\]]+)\]/g
  while ((m = re.exec(path)) !== null) {
    steps.push({ k: m[1] !== undefined ? m[1] : m[2] })
  }
  return steps
}
function getPath(obj, path, fallback) {
  let cur = obj
  for (const s of parsePath(path)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return fallback
    cur = cur[s.k]
  }
  return cur === undefined ? fallback : cur
}
module.exports = { parsePath, getPath }
