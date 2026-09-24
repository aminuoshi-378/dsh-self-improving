function reverse(str) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(str), (s) => s.segment).reverse().join('')
}
module.exports = { reverse }
