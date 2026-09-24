const fs = require('node:fs')
const path = require('node:path')

async function dirStats(dir) {
  let files = 0
  let bytes = 0
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      const sub = await dirStats(p)
      files += sub.files
      bytes += sub.bytes
    } else {
      const st = await fs.promises.lstat(p)
      files++
      bytes += st.size
    }
  }
  return { files, bytes }
}
module.exports = { dirStats }
