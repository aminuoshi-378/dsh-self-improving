// Task: displayWidth(str) returns the terminal display width. Count per
// Unicode CODE POINT:
//   width 2 (wide): U+1100-U+115F, U+2E80-U+303E, U+3041-U+A4CF,
//                   U+A960-U+A97F, U+AC00-U+D7A3, U+F900-U+FAFF,
//                   U+FE10-U+FE19, U+FF00-U+FF60, U+FFE0-U+FFE6,
//                   U+1F300-U+1F64F
//   width 0 (marks): U+0300-U+036F, U+200B-U+200D, U+FE00-U+FE0F
//   width 1: everything else
// padTo(str, width) returns str unchanged when displayWidth(str) >= width,
// otherwise returns str right-padded with ASCII spaces so its display width
// becomes exactly width.
// padTo('ab', 4) -> 'ab  '; padTo('\uD55C', 2) -> '\uD55C' (already exact)

function displayWidth(str) {
  // BUGGY: code-unit count.
  return str.length
}

function padTo(str, width) {
  // BUGGY: pads by code-unit difference.
  return str + ' '.repeat(Math.max(0, width - str.length))
}

module.exports = { displayWidth, padTo }
