const { flattenPaths } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(flattenPaths({ a: { b: 1 }, c: 2 }), ['a.b', 'c'], 'nested paths, sorted')
deepEq(flattenPaths({}), [], 'empty object')
deepEq(flattenPaths({ x: [1, 2], z: { y: 3 } }), ['x', 'z.y'], 'arrays are leaves')
console.log('PASS: flattenPaths walks and sorts leaf paths')
