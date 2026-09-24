const { reverse } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(reverse('q\u0323\u0307a'), 'aq\u0323\u0307', 'combining chain stays on base')
eq(reverse('x\u{1F469}\u200D\u{1F4BC}y'), 'y\u{1F469}\u200D\u{1F4BC}x', 'ZWJ family between ascii')
eq(reverse('\u{1F1E6}\u{1F1F7}\u{1F1FA}\u{1F1F8}'), '\u{1F1FA}\u{1F1F8}\u{1F1E6}\u{1F1F7}', 'two flags swap as units')
eq(reverse('no\u0065\u0301'), '\u0065\u0301on', 'decomposed word keeps accent on e')
eq(reverse('\u{1F1FA}\u{1F1F8}!'), '!\u{1F1FA}\u{1F1F8}', 'flag plus ascii')
eq(reverse('\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'), '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', 'family emoji is whole')
console.log('PASS: reverse by grapheme clusters (held-out)')
