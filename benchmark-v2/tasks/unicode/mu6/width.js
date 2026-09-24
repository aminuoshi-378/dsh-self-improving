// width.js — terminal display width table.
// test.cjs is the complete behavioral contract for this workspace.
function displayWidth(str) {
  // marks are counted as 1.
  let w = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0x303E)
      || (cp >= 0x3041 && cp <= 0xA4CF) || (cp >= 0xA960 && cp <= 0xA97F)
      || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0xFE10 && cp <= 0xFE19) || (cp >= 0xFFE0 && cp <= 0xFFE6)
      || (cp >= 0x1F300 && cp <= 0x1F64F)) { w += 2; continue }
    w += 1
  }
  return w
}
module.exports = { displayWidth }
