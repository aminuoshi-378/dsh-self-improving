const fs = require('node:fs/promises')
async function ensureDir(dir) {
  try {
    await fs.access(dir)
    return { created: false }
  } catch {
    await fs.mkdir(dir, { recursive: true })
    return { created: true }
  }
}
module.exports = { ensureDir }
