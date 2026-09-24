const { uniqueByKey } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(uniqueByKey([{ id: 1, x: 'first' }, { id: 2 }, { id: 1, x: 'dup' }, { id: 3 }], 'id'),
  [{ id: 1, x: 'first' }, { id: 2 }, { id: 3 }], 'keeps the FIRST occurrence')
deepEq(uniqueByKey([], 'id'), [], 'empty input')
deepEq(uniqueByKey([{ id: 1 }], 'id'), [{ id: 1 }], 'single item')
console.log('PASS: uniqueByKey keeps first occurrences in order')
