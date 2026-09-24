// Task: displayWidth(str) returns the terminal display width. Count per
// Unicode CODE POINT:
//   width 2 (wide): U+1100-U+115F, U+2E80-U+303E, U+3041-U+A4CF,
//                   U+A960-U+A97F, U+AC00-U+D7A3, U+F900-U+FAFF,
//                   U+FE10-U+FE19, U+FF00-U+FF60, U+FFE0-U+FFE6,
//                   U+1F300-U+1F64F
//   width 0 (marks): U+0300-U+036F, U+200B-U+200D, U+FE00-U+FE0F
//   width 1: everything else
// displayWidth('abc') -> 3; displayWidth('\uD55Ca') -> 3 (Hangul counts 2)

function displayWidth(str) {
  // BUGGY: UTF-16 code-unit count — wrong for surrogate pairs and marks.
  return str.length
}

module.exports = { displayWidth }
