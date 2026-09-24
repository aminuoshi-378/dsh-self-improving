// Task: fileSize(file) resolves the size in BYTES, or null when the file is
// missing (never throws).

const fs = require('node:fs/promises')

async function fileSize(file) {
  // BUGGY: raw stat propagates ENOENT.
  const stat = await fs.stat(file)
  return stat.size
}

module.exports = { fileSize }
