const { sortByPath } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
const input = [{ v: { s: 2 } }, { v: { s: 1 } }, { v: { s: 3 } }]
deepEq(sortByPath(input, 'v.s'), [{ v: { s: 1 } }, { v: { s: 2 } }, { v: { s: 3 } }], 'sorts by the nested value')
deepEq(input, [{ v: { s: 2 } }, { v: { s: 1 } }, { v: { s: 3 } }], 'input not mutated')
console.log('PASS: sortByPath follows dot paths')
