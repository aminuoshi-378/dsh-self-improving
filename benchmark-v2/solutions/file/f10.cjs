const fs = require('node:fs/promises')
const path = require('node:path')
async function newestFile(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  let best = null
  let bestMtime = -Infinity
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const mtime = (await fs.stat(path.join(dir, entry.name))).mtimeMs
    if (mtime > bestMtime) { bestMtime = mtime; best = entry.name }
  }
  return best
}
module.exports = { newestFile }
