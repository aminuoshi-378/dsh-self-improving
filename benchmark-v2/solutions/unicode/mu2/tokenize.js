function graphemes(str) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(str), (s) => s.segment)
}
module.exports = { graphemes }
