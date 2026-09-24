// Task: newestFile(dir) resolves the FILENAME of the most recently modified
// file directly inside dir, or null when the directory holds no files.

const fs = require('node:fs/promises')

async function newestFile(dir) {
  // BUGGY: returns the first entry readdir happens to give.
  const names = await fs.readdir(dir)
  return names.length ? names[0] : null
}

module.exports = { newestFile }
