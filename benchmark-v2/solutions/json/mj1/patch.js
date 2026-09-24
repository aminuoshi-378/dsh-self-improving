const { parsePath } = require('./paths.js')

function parentAndKey(obj, path) {
  const steps = parsePath(path)
  if (steps === null || steps.length === 0) return null
  let cur = obj
  for (let i = 0; i < steps.length - 1; i++) {
    const s = steps[i]
    if (cur === null || cur === undefined || typeof cur !== 'object') return null
    if (s.i !== undefined) {
      if (!Array.isArray(cur) || s.i < 0 || s.i >= cur.length) return null
      cur = cur[s.i]
    } else {
      if (!(s.k in cur)) return null
      cur = cur[s.k]
    }
  }
  const last = steps[steps.length - 1]
  return { parent: cur, key: last.k !== undefined ? last.k : last.i, index: last.i !== undefined }
}

function applyPatch(obj, ops) {
  for (const op of ops) {
    const pk = parentAndKey(obj, op.path)
    if (pk === null) continue
    if (op.op === 'set') {
      if (pk.index && Array.isArray(pk.parent)) {
        if (pk.key === pk.parent.length || pk.key < pk.parent.length) pk.parent[pk.key] = op.value
      } else if (!pk.index) {
        pk.parent[pk.key] = op.value
      }
    } else if (op.op === 'add') {
      if (pk.index && Array.isArray(pk.parent)) {
        pk.parent.push(op.value)
      } else if (!pk.index) {
        const existing = pk.parent[pk.key]
        if (Array.isArray(existing)) existing.push(op.value)
        else pk.parent[pk.key] = op.value
      }
    } else if (op.op === 'remove') {
      if (pk.index && Array.isArray(pk.parent) && pk.key < pk.parent.length) pk.parent.splice(pk.key, 1)
      else if (!pk.index) delete pk.parent[pk.key]
    }
  }
  return obj
}
module.exports = { applyPatch }
