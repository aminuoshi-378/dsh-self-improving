const { groupVisual } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
eqJson(groupVisual(['a\u200Cb', 'ab', 'e\u0301', '\u00e9', 'ac']),
  [['a\u200Cb', 'ab'], ['e\u0301', '\u00e9'], ['ac']], 'ZWSP+NFC groups merge')
eqJson(groupVisual(['A', 'a']), [['A'], ['a']], 'case keeps groups apart')
eqJson(groupVisual([]), [], 'empty input')
eqJson(groupVisual(['xy\u00ADz', 'xyz', 'xy\u00ADz']),
  [['xy\u00ADz', 'xyz', 'xy\u00ADz']], 'soft hyphen groups merge, dupes preserved')
eqJson(groupVisual(['b', 'a']), [['b'], ['a']], 'order of first appearance')
console.log('PASS: group by visual identity (held-out)')
