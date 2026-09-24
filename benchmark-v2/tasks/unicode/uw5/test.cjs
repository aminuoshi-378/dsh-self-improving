const { removeAt } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(removeAt('a\u{1F600}b', 1), 'ab', 'remove the emoji code point')
eq(removeAt('abc', 0), 'bc', 'remove ascii')
eq(removeAt('ab', 9), 'ab', 'out of range unchanged')
eq(removeAt('x', 0), '', 'single char to empty')
console.log('PASS: removeAt is code-point indexed')
