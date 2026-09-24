const { zipStrings } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(zipStrings('ab', '\u{1F600}x'), 'a\u{1F600}bx', 'emoji zips as one')
eq(zipStrings('abc', 'xy'), 'axbyc', 'unequal lengths append leftovers')
eq(zipStrings('', 'ab'), 'ab', 'empty first')
eq(zipStrings('\u{1F600}\u{1F600}', '\u{1F600}'), '\u{1F600}\u{1F600}\u{1F600}', 'emoji pairs')
console.log('PASS: zipStrings interleaves whole code points')
