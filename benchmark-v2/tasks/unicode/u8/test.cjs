const { replaceCodePointAt } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(replaceCodePointAt('a\u{1F600}b', 1, 'x'), 'axb', 'replace an emoji with ascii')
eq(replaceCodePointAt('abc', 0, '\u{1F600}'), '\u{1F600}bc', 'replace ascii with emoji')
eq(replaceCodePointAt('ab', 9, 'z'), 'ab', 'out of range unchanged')
eq(replaceCodePointAt('\u{1F600}a\u{1F600}', 1, 'bb'), '\u{1F600}bb\u{1F600}', 'between two emojis')
console.log('PASS: replaceCodePointAt splices whole code points')
