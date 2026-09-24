const fs = require('node:fs/promises')
async function concatFiles(dst, srcs) {
  const parts = []
  for (const src of srcs) parts.push(await fs.readFile(src, 'utf8'))
  await fs.writeFile(dst, parts.join(''))
}
module.exports = { concatFiles }
