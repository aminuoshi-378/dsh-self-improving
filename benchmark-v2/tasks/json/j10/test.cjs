const { countLeaves } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(countLeaves({ a: 1, b: { c: 2, d: [3, 4] } }), 4, 'objects recurse, arrays count elements')
eq(countLeaves({}), 0, 'empty object')
eq(countLeaves({ x: [1, 2, { y: 3 }] }), 3, 'nested objects inside arrays recurse')
console.log('PASS: countLeaves counts every primitive leaf')
