const fs = require('node:fs/promises')
async function appendLine(filePath, line) {
  await fs.appendFile(filePath, `${line}\n`)
  const text = await fs.readFile(filePath, 'utf8')
  const trimmed = text.replace(/\n$/, '')
  return trimmed === '' ? 0 : trimmed.split('\n').length
}
module.exports = { appendLine }
