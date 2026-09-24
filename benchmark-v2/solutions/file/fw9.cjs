const fs = require('node:fs/promises')
async function listDirs(base) {
  const entries = await fs.readdir(base, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}
module.exports = { listDirs }
