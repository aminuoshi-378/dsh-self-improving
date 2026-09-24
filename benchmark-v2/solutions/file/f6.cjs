const fs = require('node:fs/promises')
async function copyIfNewer(src, dst) {
  let dstStat = null
  try {
    dstStat = await fs.stat(dst)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (dstStat && (await fs.stat(src)).mtimeMs <= dstStat.mtimeMs) return { copied: false }
  await fs.copyFile(src, dst)
  return { copied: true }
}
module.exports = { copyIfNewer }
