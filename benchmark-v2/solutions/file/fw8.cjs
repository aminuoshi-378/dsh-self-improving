const fs = require('node:fs/promises')
async function moveFile(src, dst) {
  try {
    await fs.access(dst)
    return { moved: false }
  } catch {
    await fs.rename(src, dst)
    return { moved: true }
  }
}
module.exports = { moveFile }
