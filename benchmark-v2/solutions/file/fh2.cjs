const fs = require('node:fs')

function appendDedup(file, line, window = 3) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : []
  const tail = lines.slice(-window)
  if (tail.includes(line)) return false
  fs.appendFileSync(file, (lines.length ? '\n' : '') + line)
  return true
}
module.exports = { appendDedup }
