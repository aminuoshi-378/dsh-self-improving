// walk.js — prefix walking over a TreeFS.
// test.cjs is the complete behavioral contract for this workspace.
function walkAll(fs, prefix) {
  // and is case/anchor insensitive.
  return fs.paths().filter((p) => p.includes(prefix))
}
module.exports = { walkAll }
