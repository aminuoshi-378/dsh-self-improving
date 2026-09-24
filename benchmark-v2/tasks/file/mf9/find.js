// find.js — glob search over the tree.
// test.cjs is the complete behavioral contract for this workspace.
const { matchGlob } = require('./pattern.js')

function find(fs, pattern) {
  return fs.paths().filter((p) => p.includes(pattern.replace(/[*?]/g, '')))
}
module.exports = { find }
