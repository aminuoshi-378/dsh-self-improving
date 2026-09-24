const fs = require('node:fs/promises')
async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}
module.exports = { readJson }
