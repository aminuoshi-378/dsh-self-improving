const { isNonBmpAt } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(isNonBmpAt('a\u{1F600}b', 1), true, 'emoji is non-BMP at index 1')
eq(isNonBmpAt('abc', 0), false, 'ascii is BMP')
eq(isNonBmpAt('\u{1F600}', 0), true, 'single emoji')
eq(isNonBmpAt('\u4e2da', 0), false, 'chinese chars are BMP')
console.log('PASS: isNonBmpAt detects non-BMP code points')
