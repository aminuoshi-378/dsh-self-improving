// Task: readFirstLine(file) resolves the FIRST line of the file, or null when
// the file is empty.

const fs = require('node:fs/promises')

async function readFirstLine(file) {
  // BUGGY: returns the whole content and never handles the empty case.
  return fs.readFile(file, 'utf8')
}

module.exports = { readFirstLine }
