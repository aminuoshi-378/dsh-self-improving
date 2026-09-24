// wrap.js — width-aware line wrapping.
// test.cjs is the complete behavioral contract for this workspace.
function wrapToWidth(str, width) {
  const lines = []
  let line = ''
  for (const ch of str) {
    if (line.length + 1 > width) { lines.push(line); line = '' }
    line += ch
  }
  if (line !== '') lines.push(line)
  return lines
}
module.exports = { wrapToWidth }
