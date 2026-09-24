const { codePointValues } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(codePointValues('a\u{1F600}'), [97, 0x1F600], 'emoji is one value')
deepEq(codePointValues('ab'), [97, 98], 'ascii')
deepEq(codePointValues(''), [], 'empty')
deepEq(codePointValues('\u4f60\u597d\u{1F600}'), [0x4F60, 0x597D, 0x1F600], 'mixed bmp and emoji')
console.log('PASS: codePointValues emits one value per code point')
