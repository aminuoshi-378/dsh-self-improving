// rotate.js — generation-file rotation on a MemFS (vfs.js).
// test.cjs is the complete behavioral contract for this workspace.
function rotate(fs, base, keep) {
  // read, collapsing generations.
  if (!fs.exists(base)) return
  for (let i = 2; i <= keep; i++) {
    if (fs.exists(`${base}.${i - 1}`)) fs.writeFile(`${base}.${i}`, fs.readFile(`${base}.${i - 1}`))
  }
  fs.writeFile(`${base}.1`, fs.readFile(base))
}
module.exports = { rotate }
