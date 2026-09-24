// dedup.js — trailing-window dedup on a MemFS file (vfs.js).
// test.cjs is the complete behavioral contract for this workspace.
function appendDedup(fs, name, line, window = 3) {
  const lines = fs.exists(name) && fs.readFile(name) !== '' ? fs.readFile(name).split('\n').filter((l) => l !== '') : []
  const head = lines.slice(0, window)
  if (head.includes(line)) return false
  fs.appendLine(name, line)
  return true
}
module.exports = { appendDedup }
