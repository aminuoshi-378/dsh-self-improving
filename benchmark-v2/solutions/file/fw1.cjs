const fs = require('node:fs/promises')
async function writeIfChanged(filePath, data) {
  let current = null
  try {
    current = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (current === data) return { changed: false }
  await fs.writeFile(filePath, data)
  return { changed: true }
}
module.exports = { writeIfChanged }
