const { firstCodePoint } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(firstCodePoint('\u{1F600}ab'), '\u{1F600}', 'emoji first stays whole')
eq(firstCodePoint('abc'), 'a', 'ascii')
eq(firstCodePoint('a'), 'a', 'single char')
eq(firstCodePoint('\u4e2d\u{1F600}'), '\u4e2d', 'bmp chinese before emoji')
console.log('PASS: firstCodePoint returns the first code point intact')
