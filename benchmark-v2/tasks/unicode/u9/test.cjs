const { countOccurrences } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(countOccurrences('a\u{1F600}b\u{1F600}c', '\u{1F600}'), 2, 'two emoji occurrences')
eq(countOccurrences('aaa', 'a'), 3, 'three ascii occurrences')
eq(countOccurrences('abc', 'z'), 0, 'absent sub')
eq(countOccurrences('x\u4e2dx\u4e2dx', '\u4e2d'), 2, 'bmp sub')
console.log('PASS: countOccurrences counts every non-overlapping match')
