const { matchGlob } = require('./pattern.js')

function find(fs, pattern) {
  return fs.paths().filter((p) => matchGlob(pattern, p))
}
module.exports = { find }
