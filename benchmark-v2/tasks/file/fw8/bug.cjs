// Task: moveFile(src, dst) moves the file; when dst ALREADY EXISTS it resolves
// { moved: false } and leaves BOTH files untouched (no overwrite).

const fs = require('node:fs/promises')

async function moveFile(src, dst) {
  // BUGGY: unconditional rename overwrites the destination.
  await fs.rename(src, dst)
  return { moved: true }
}

module.exports = { moveFile }
