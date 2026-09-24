const fs = require('node:fs/promises')
async function writeTextIfMissing(file, data) {
  try {
    await fs.access(file)
    return { written: false }
  } catch {
    await fs.writeFile(file, data)
    return { written: true }
  }
}
module.exports = { writeTextIfMissing }
