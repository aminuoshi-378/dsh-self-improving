const { substringByCodePoints } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(substringByCodePoints('a\u{1F600}bc\u{1F600}d', 1, 4), '\u{1F600}bc', 'span includes both emojis intact')
eq(substringByCodePoints('abcdef', 0, 3), 'abc', 'ascii start')
eq(substringByCodePoints('ab', 5, 9), '', 'clamped to empty')
eq(substringByCodePoints('\u{1F600}ab', 0, 1), '\u{1F600}', 'single emoji span')
console.log('PASS: substringByCodePoints slices whole code points')
