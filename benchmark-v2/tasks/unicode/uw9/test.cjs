const { takeWhileBmp } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(takeWhileBmp('ab\u{1F600}cd'), 'ab', 'stops before the emoji, keeps it whole')
eq(takeWhileBmp('\u{1F600}'), '', 'emoji first means empty run')
eq(takeWhileBmp('abc'), 'abc', 'all bmp')
eq(takeWhileBmp('\u4e2d\u{1F600}\u4e2d'), '\u4e2d', 'chinese bmp kept, stops at emoji')
console.log('PASS: takeWhileBmp never emits broken surrogates')
