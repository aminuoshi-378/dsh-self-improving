const { reverseWords } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(reverseWords('a\u{1F600} x'), '\u{1F600}a x', 'emoji inside first word survives')
eq(reverseWords('ab cd'), 'ba dc', 'two words keep order')
eq(reverseWords(''), '', 'empty')
eq(reverseWords('\u4e2d\u{1F600}'), '\u{1F600}\u4e2d', 'bmp+emoji word')
console.log('PASS: reverseWords keeps emoji whole')
