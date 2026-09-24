const { getPath } = require('./paths.js')
const { applyPatch } = require('./patch.js')

function createDocument(initial) {
  const data = JSON.parse(JSON.stringify(initial ?? {}))
  return {
    get: (path) => getPath(data, path, undefined),
    set: (path, value) => applyPatch(data, [{ op: 'set', path, value }]),
    apply: (ops) => applyPatch(data, ops),
    toJSON: () => JSON.parse(JSON.stringify(data)),
  }
}
module.exports = { createDocument }
