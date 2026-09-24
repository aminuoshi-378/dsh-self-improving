const { lastIndexOfCodePoint } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(lastIndexOfCodePoint('\u{1F600}ab\u{1F600}c', '\u{1F600}'), 3, 'emoji index counts code points')
eq(lastIndexOfCodePoint('abcabc', 'c'), 5, 'ascii index matches')
eq(lastIndexOfCodePoint('ab', 'z'), -1, 'missing char')
eq(lastIndexOfCodePoint('x\u{1F600}', 'x'), 0, 'before an emoji')
console.log('PASS: lastIndexOfCodePoint indexes by code point')
