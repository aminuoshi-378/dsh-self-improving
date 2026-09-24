// Task: atomicWrite(filePath, data) writes data through a TEMPORARY file in
// the SAME directory, then renames the temp file onto filePath (atomic
// replace). After it returns, the directory must contain ONLY the target
// file — no leftover temp files.

const fs = require('node:fs/promises')

async function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}`
  // BUGGY: writes the temp file but never renames it onto the target,
  // leaving both a missing target and a leftover temp file.
  await fs.writeFile(tmp, data)
}

module.exports = { atomicWrite }
