const { sameVisual } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(sameVisual('\u00e9', 'e\u0301'), true, 'precomposed vs decomposed')
eq(sameVisual('a\u200Cb', 'ab'), true, 'ZWSP ignored')
eq(sameVisual('a\u200Cb', 'a\u200Db'), true, 'ZWSP vs ZWNJ both invisible')
eq(sameVisual('x\u00ADy', 'xy'), true, 'soft hyphen ignored')
eq(sameVisual('A', 'a'), false, 'case-sensitive')
eq(sameVisual('ab', 'ac'), false, 'different strings')
eq(sameVisual('caf\u00e9', 'cafe\u0301'), true, 'word with accent, mixed forms')
eq(sameVisual('', ''), true, 'empty strings')
console.log('PASS: visual equality via NFC + invisible stripping')
