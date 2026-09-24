// layout.js — line alignment.
// test.cjs is the complete behavioral contract for this workspace.
function alignLines(lines, width, mode) {
  // and padding uses code units, not display width.
  return lines.map((line) => {
    const pad = Math.max(0, width - line.length)
    if (mode === 'left') return line + ' '.repeat(pad)
    if (mode === 'right') return ' '.repeat(pad) + line
    const l = Math.floor(pad / 2)
    const r = pad - l
    return ' '.repeat(l) + line + ' '.repeat(r)
  })
}
module.exports = { alignLines }
