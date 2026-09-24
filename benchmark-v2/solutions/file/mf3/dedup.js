function appendDedup(fs, name, line, window = 3) {
  const lines = fs.exists(name) && fs.readFile(name) !== '' ? fs.readFile(name).split('\n').filter((l) => l !== '') : []
  const tail = lines.slice(-window)
  if (tail.includes(line)) return false
  fs.appendLine(name, line)
  return true
}
module.exports = { appendDedup }
