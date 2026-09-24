// Task: copyFiles(srcDir, dstDir) copies every FILE (subdirectories ignored)
// from srcDir into dstDir (created when missing) and resolves the copied count.

const fs = require('node:fs/promises')

async function copyFiles(srcDir, dstDir) {
  // BUGGY: recursive copy also drags subdirectories along.
  await fs.cp(srcDir, dstDir, { recursive: true })
  const entries = await fs.readdir(dstDir)
  return entries.length
}

module.exports = { copyFiles }
