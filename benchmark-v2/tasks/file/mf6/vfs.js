// vfs.js — an in-memory tree of files (verified stable, do not change).
// test.cjs is the complete behavioral contract for this workspace.
class TreeFS {
  constructor(entries) { this.map = new Map(Object.entries(entries)) }
  paths() { return [...this.map.keys()].sort() }
  content(path) { return this.map.get(path) }
}
module.exports = { TreeFS }
