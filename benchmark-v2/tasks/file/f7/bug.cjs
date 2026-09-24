// Task: writeTextIfMissing(file, data) writes ONLY when the file does not
// exist; an existing file (and its mtime) stays untouched; resolves
// { written: boolean }.

const fs = require('node:fs/promises')

async function writeTextIfMissing(file, data) {
  // BUGGY: always writes — the mtime churns and written is always true.
  await fs.writeFile(file, data)
  return { written: true }
}

module.exports = { writeTextIfMissing }
