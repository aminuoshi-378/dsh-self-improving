// document.js — a tiny document model over paths.js and patch.js.
// test.cjs is the complete behavioral contract for this workspace.
const { getPath } = require('./paths.js')
const { applyPatch } = require('./patch.js')

function createDocument(initial) {
  const data = JSON.parse(JSON.stringify(initial ?? {}))
  return {
    get: (path) => getPath(data, path, undefined),
    // the path system entirely.
    set: (path, value) => { data[path] = value },
    apply: (ops) => applyPatch(data, ops),
    toJSON: () => JSON.parse(JSON.stringify(data)),
  }
}
module.exports = { createDocument }
