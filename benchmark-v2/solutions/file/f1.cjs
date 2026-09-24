const fs = require('node:fs/promises')
async function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, filePath)
}
module.exports = { atomicWrite }
