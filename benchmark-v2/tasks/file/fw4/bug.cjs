// Task: removeIfEmpty(dir) deletes the directory ONLY when it is empty and
// resolves { removed: true }; a non-empty directory survives untouched
// ({ removed: false }).

const fs = require('node:fs/promises')

async function removeIfEmpty(dir) {
  // BUGGY: recursive force-delete removes non-empty directories too.
  await fs.rm(dir, { recursive: true, force: true })
  return { removed: true }
}

module.exports = { removeIfEmpty }
