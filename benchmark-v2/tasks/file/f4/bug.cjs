// Task: rotateBackup(filePath, keep=2) shifts backup files up one slot:
// file.(keep-1) -> file.keep, ..., file.1 -> file.2, file -> file.1.
// It must first REMOVE the slot that would fall beyond `keep`, so at most
// `keep` backups ever exist (file.1 ... file.keep). The main file is
// consumed (renamed into file.1).

const fs = require('node:fs/promises')

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function rotateBackup(filePath, keep = 2) {
  // BUGGY: never drops the oldest backup, so backups grow past `keep`
  // (file.3, file.4, ... appear over time).
  for (let i = keep; i >= 1; i--) {
    const src = `${filePath}.${i}`
    if (await exists(src)) await fs.rename(src, `${filePath}.${i + 1}`)
  }
  await fs.rename(filePath, `${filePath}.1`)
}

module.exports = { rotateBackup }
