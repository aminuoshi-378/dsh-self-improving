const fs = require('node:fs/promises')
async function readFirstLine(file) {
  const text = await fs.readFile(file, 'utf8')
  if (text === '') return null
  return text.split('\n')[0]
}
module.exports = { readFirstLine }
