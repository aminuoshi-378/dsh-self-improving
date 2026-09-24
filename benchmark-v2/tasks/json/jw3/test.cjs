const { setPath } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(setPath({}, 'a.b.c', 1), { a: { b: { c: 1 } } }, 'creates the whole chain')
deepEq(setPath({ a: { d: 2 } }, 'a.b', 3), { a: { d: 2, b: 3 } }, 'existing sibling survives')
deepEq(setPath({}, 'x', 9), { x: 9 }, 'single key')
console.log('PASS: setPath builds missing intermediates without throwing')
