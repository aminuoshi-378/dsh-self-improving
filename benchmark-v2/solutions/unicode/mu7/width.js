// width.js — terminal display width table.
// displayWidth(str) counts per Unicode CODE POINT:
//   width 2 (wide): U+1100-U+115F, U+2E80-U+303E, U+3041-U+A4CF, U+A960-U+A97F,
//                   U+AC00-U+D7A3, U+F900-U+FAFF, U+FE10-U+FE19, U+FF00-U+FF60,
//                   U+FFE0-U+FFE6, U+1F300-U+1F64F
//   width 0 (marks): U+0300-U+036F, U+200B-U+200D, U+FE00-U+FE0F
//   width 1: everything else
function displayWidth(str) {
  let w = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    if ((cp >= 0x0300 && cp <= 0x036F) || (cp >= 0x200B && cp <= 0x200D) || (cp >= 0xFE00 && cp <= 0xFE0F)) continue
    if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0x303E)
      || (cp >= 0x3041 && cp <= 0xA4CF) || (cp >= 0xA960 && cp <= 0xA97F)
      || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0xFE10 && cp <= 0xFE19) || (cp >= 0xFF00 && cp <= 0xFF60)
      || (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x1F300 && cp <= 0x1F64F)) { w += 2; continue }
    w += 1
  }
  return w
}
module.exports = { displayWidth }
