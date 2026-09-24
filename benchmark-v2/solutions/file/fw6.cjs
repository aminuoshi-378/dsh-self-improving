const fs = require('node:fs/promises')
async function fileSize(file) {
  try { return (await fs.stat(file)).size } catch { return null }
}
module.exports = { fileSize }
