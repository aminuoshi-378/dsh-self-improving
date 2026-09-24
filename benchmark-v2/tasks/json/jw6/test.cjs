const { groupBy } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(
  groupBy([{ t: 'a', v: 1 }, { t: 'b', v: 2 }, { t: 'a', v: 3 }], 't'),
  { a: [{ t: 'a', v: 1 }, { t: 'a', v: 3 }], b: [{ t: 'b', v: 2 }] },
  'groups accumulate into arrays',
)
deepEq(groupBy([], 't'), {}, 'empty input')
console.log('PASS: groupBy collects every item')
