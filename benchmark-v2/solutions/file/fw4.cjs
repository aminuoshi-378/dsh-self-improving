const fs = require('node:fs/promises')
async function removeIfEmpty(dir) {
  if ((await fs.readdir(dir)).length > 0) return { removed: false }
  await fs.rmdir(dir)
  return { removed: true }
}
module.exports = { removeIfEmpty }
