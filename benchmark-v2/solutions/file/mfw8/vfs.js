// vfs.js — an in-memory tree of files (verified stable, do not change).
// new TreeFS({ 'src/a.js': 'x', 'src/sub/b.js': 'y' }) stores file paths
// (directories are implied); paths(path) lists ALL file paths sorted;
// content(path) reads one file.
class TreeFS {
  constructor(entries) { this.map = new Map(Object.entries(entries)) }
  paths() { return [...this.map.keys()].sort() }
  content(path) { return this.map.get(path) }
}
module.exports = { TreeFS }
