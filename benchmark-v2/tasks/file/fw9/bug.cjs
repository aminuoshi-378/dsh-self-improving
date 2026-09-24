// Task: listDirs(base) returns the SORTED names of the immediate SUBDIRECTORIES
// of base (files are ignored).

const fs = require('node:fs/promises')

async function listDirs(base) {
  // BUGGY: returns every entry, files included.
  const all = await fs.readdir(base)
  return all.sort()
}

module.exports = { listDirs }
