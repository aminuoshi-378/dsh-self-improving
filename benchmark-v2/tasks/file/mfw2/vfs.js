// vfs.js — an in-memory flat file store (verified stable, do not change).
// test.cjs is the complete behavioral contract for this workspace.
class MemFS {
  constructor() { this.files = new Map() }
  writeFile(name, content) { this.files.set(name, String(content)) }
  readFile(name) { return this.files.get(name) }
  exists(name) { return this.files.has(name) }
  list() { return [...this.files.keys()].sort() }
  lineCount(name) {
    const c = this.files.get(name)
    if (c === undefined) return -1
    if (c === '') return 0
    return c.split('\n').filter((l) => l !== '').length
  }
  appendLine(name, line) {
    const c = this.files.get(name) ?? ''
    const lines = c === '' ? [] : c.split('\n').filter((l) => l !== '')
    lines.push(line)
    this.files.set(name, lines.join('\n'))
  }
}
module.exports = { MemFS }
