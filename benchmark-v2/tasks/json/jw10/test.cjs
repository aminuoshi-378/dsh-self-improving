const { fromPairs } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(fromPairs([['a', 1], ['b', 2]]), { a: 1, b: 2 }, 'basic pairs')
deepEq(fromPairs([['a', 1], ['a', 9]]), { a: 9 }, 'duplicate key: last wins')
deepEq(fromPairs([]), {}, 'empty input')
console.log('PASS: fromPairs honors last-wins for duplicate keys')
