const { reverse } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(reverse(''), '', 'empty')
eq(reverse('abc'), 'cba', 'ascii')
eq(reverse('a\u{1F600}bc'), 'cb\u{1F600}a', 'surrogate pair as one unit')
eq(reverse('e\u0301x'), 'xe\u0301', 'combining mark stays on its base')
eq(reverse('\u{1F1FA}\u{1F1F8}'), '\u{1F1FA}\u{1F1F8}', 'flag pair moves as one unit')
eq(reverse('a\u{1F1FA}\u{1F1F8}b'), 'b\u{1F1FA}\u{1F1F8}a', 'flag between ascii')
eq(reverse('\u{1F468}\u200D\u{1F4BB}'), '\u{1F468}\u200D\u{1F4BB}', 'ZWJ family stays whole')
console.log('PASS: reverse by grapheme clusters')
