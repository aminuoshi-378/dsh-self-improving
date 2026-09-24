// Task: writeIfChanged(filePath, data) writes only when the file is missing or
// its current content differs. Returns { changed: boolean }. An unchanged
// write must leave the file (and its mtime) completely untouched.

const fs = require('node:fs/promises')

async function writeIfChanged(filePath, data) {
  // BUGGY: always writes and always reports changed — callers lose all signal
  // and timestamps churn on every call.
  await fs.writeFile(filePath, data)
  return { changed: true }
}

module.exports = { writeIfChanged }
