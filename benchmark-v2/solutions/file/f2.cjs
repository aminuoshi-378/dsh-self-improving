const fs = require('node:fs/promises')
async function updateJson(filePath, updates) {
  let current = {}
  try {
    current = JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const merged = { ...current, ...updates }
  await fs.writeFile(filePath, JSON.stringify(merged, null, 2) + '\n')
}
module.exports = { updateJson }
