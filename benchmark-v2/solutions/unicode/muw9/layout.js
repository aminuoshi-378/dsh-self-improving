function alignLines(lines, width, mode) {
  const { displayWidth } = require('./width.js')
  return lines.map((line) => {
    const pad = Math.max(0, width - displayWidth(line))
    if (mode === 'left') return line + ' '.repeat(pad)
    if (mode === 'right') return ' '.repeat(pad) + line
    const l = Math.ceil(pad / 2)
    const r = pad - l
    return ' '.repeat(l) + line + ' '.repeat(r)
  })
}
module.exports = { alignLines }
