const { pick } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
const src = { a: 1, b: 2, c: 3 }
deepEq(pick(src, ['a', 'c']), { a: 1, c: 3 }, 'only listed keys survive')
deepEq(src, { a: 1, b: 2, c: 3 }, 'the original is untouched')
deepEq(pick({ x: 1 }, []), {}, 'empty pick')
deepEq(pick({ x: 1 }, ['missing']), {}, 'missing key is harmless')
console.log('PASS: pick copies without mutating the original')
