function wrapToWidth(str, width) {
  const { displayWidth } = require('./width.js')
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const clusters = Array.from(segmenter.segment(str), (s) => s.segment)
  const lines = []
  let line = ''
  for (const c of clusters) {
    if (line !== '' && displayWidth(line + c) > width) { lines.push(line); line = c }
    else line += c
  }
  if (line !== '') lines.push(line)
  return lines
}
module.exports = { wrapToWidth }
