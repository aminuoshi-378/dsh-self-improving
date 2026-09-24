// Task: dirStats(dir) returns a Promise of { files, bytes }: recursively
// count every regular file under dir, including dotfiles. Symbolic links
// (file links, dir links, or broken links) are skipped entirely: never
// followed, never counted. Subdirectories recurse.

const fs = require('node:fs')
const path = require('node:path')

async function dirStats(dir) {
  // BUGGY: follows symlinks via stat(), counting their targets (and
  // crashing on broken links).
  let files = 0
  let bytes = 0
  for (const name of await fs.promises.readdir(dir)) {
    const p = path.join(dir, name)
    const st = await fs.promises.stat(p)
    if (st.isDirectory()) {
      const sub = await dirStats(p)
      files += sub.files
      bytes += sub.bytes
    } else {
      files++
      bytes += st.size
    }
  }
  return { files, bytes }
}

module.exports = { dirStats }
