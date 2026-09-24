const { sortByKey } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
const input = [{ n: 'c' }, { n: 'a' }, { n: 'b' }]
deepEq(sortByKey(input, 'n'), [{ n: 'a' }, { n: 'b' }, { n: 'c' }], 'sorted by the key field')
deepEq(input, [{ n: 'c' }, { n: 'a' }, { n: 'b' }], 'input not mutated')
deepEq(sortByKey([], 'n'), [], 'empty input')
console.log('PASS: sortByKey sorts a copy by the given key')
