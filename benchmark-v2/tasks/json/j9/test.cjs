const { invert } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(invert({ a: 'x', b: 'y' }), { x: 'a', y: 'b' }, 'basic inversion')
deepEq(invert({ a: 'x', b: 'x' }), { x: 'b' }, 'collision: last key wins')
deepEq(invert({}), {}, 'empty object')
console.log('PASS: invert honors last-wins on collisions')
