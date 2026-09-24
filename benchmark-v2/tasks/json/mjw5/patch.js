// patch.js — path-based mutation operations (uses paths.js).
// test.cjs is the complete behavioral contract for this workspace.
const { parsePath, getPath } = require('./paths.js')

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
  // 'remove' on arrays leaves an undefined hole instead of splicing.
  for (const op of ops) {
    const pk = parentAndKey(obj, op.path)
    if (pk === null) continue
    if (op.op === 'set') { pk.parent[pk.key] = op.value }
    else if (op.op === 'add') { pk.parent[pk.key] = op.value }
    else if (op.op === 'remove') { delete pk.parent[pk.key] }
  }
  return obj
}
module.exports = { applyPatch }
