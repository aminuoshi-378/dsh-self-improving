const fs = require('node:fs/promises')
async function listJson(dir) {
  const out = {}
  for (const name of await fs.readdir(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      out[name.replace(/\.json$/, '')] = JSON.parse(await fs.readFile(`${dir}/${name}`, 'utf8'))
    } catch {
      /* unparseable entries are skipped, never fatal */
    }
  }
  return out
}
module.exports = { listJson }
