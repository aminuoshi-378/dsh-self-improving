const { deepEqualJson } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(deepEqualJson({ a: 1, b: 2 }, { b: 2, a: 1 }), true, 'key order does not matter')
eq(deepEqualJson({ a: 1 }, { a: 2 }), false, 'different values')
eq(deepEqualJson({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }), true, 'nested key order also ignored')
eq(deepEqualJson({ a: [1, 2] }, { a: [2, 1] }), false, 'array order still matters')
console.log('PASS: deepEqualJson ignores key order')
