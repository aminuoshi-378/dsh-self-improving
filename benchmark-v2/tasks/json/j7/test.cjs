const { deletePath } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
const src = { a: { b: 1, c: 2 } }
deepEq(deletePath(src, 'a.b'), { a: { c: 2 } }, 'removes only the leaf')
deepEq(src, { a: { b: 1, c: 2 } }, 'original untouched')
deepEq(deletePath({ x: 1 }, 'y.z'), { x: 1 }, 'missing path is a no-op')
console.log('PASS: deletePath is immutable')
