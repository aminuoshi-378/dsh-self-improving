const fs = require('node:fs/promises')
async function rotateBackup(filePath, keep = 2) {
  await fs.rm(`${filePath}.${keep}`, { force: true })
  for (let i = keep - 1; i >= 1; i--) {
    await fs.rename(`${filePath}.${i}`, `${filePath}.${i + 1}`).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  await fs.rename(filePath, `${filePath}.1`)
}
module.exports = { rotateBackup }
