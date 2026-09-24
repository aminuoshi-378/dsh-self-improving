// Task: copyIfNewer(src, dst) copies src to dst ONLY when src is missing dst,
// or src's mtime is strictly newer than dst's. Returns { copied: boolean }.
// When not copying, dst must stay byte-identical AND mtime-identical.

const fs = require('node:fs/promises')

async function copyIfNewer(src, dst) {
  // BUGGY: unconditionally copies and reports copied — an older source
  // silently overwrites a newer destination.
  await fs.copyFile(src, dst)
  return { copied: true }
}

module.exports = { copyIfNewer }
