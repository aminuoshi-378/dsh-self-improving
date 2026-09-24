// Task: concatFiles(dst, srcs) writes dst as the CONCATENATION of every src
// file's content, in the given order.

const fs = require('node:fs/promises')

async function concatFiles(dst, srcs) {
  // BUGGY: writes only the LAST source.
  for (const src of srcs) {
    await fs.writeFile(dst, await fs.readFile(src, 'utf8'))
  }
}

module.exports = { concatFiles }
