const fs = require('node:fs/promises')
const path = require('node:path')
async function copyFiles(srcDir, dstDir) {
  await fs.mkdir(dstDir, { recursive: true })
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    await fs.copyFile(path.join(srcDir, entry.name), path.join(dstDir, entry.name))
    count++
  }
  return count
}
module.exports = { copyFiles }
