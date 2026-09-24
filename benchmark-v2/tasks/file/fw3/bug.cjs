// Task: ensureDir(dir) creates the directory (and any missing parents) and
// resolves { created: true }; an existing directory resolves { created: false };
// it never throws either way.

const fs = require('node:fs/promises')

async function ensureDir(dir) {
  // BUGGY: non-recursive mkdir throws when the dir (or a parent) exists.
  await fs.mkdir(dir)
  return { created: true }
}

module.exports = { ensureDir }
