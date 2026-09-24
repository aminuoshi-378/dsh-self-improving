const { unflatten } = require('./bug.cjs')

function deepEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}:\n  got  ${JSON.stringify(actual)}\n  want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

deepEq(
  unflatten({ 'user.name': 'x', 'tags.0': 'a', 'tags.1': 'b' }),
  { user: { name: 'x' }, tags: ['a', 'b'] },
  'all-numeric keys restore as arrays',
)
deepEq(
  unflatten({ 'a.b.c': 1 }),
  { a: { b: { c: 1 } } },
  'pure object nesting',
)
deepEq(
  unflatten({ 'matrix.0.0': 1, 'matrix.0.1': 2, 'matrix.1.0': 3 }),
  { matrix: [[1, 2], [3]] },
  'nested arrays',
)
deepEq(unflatten({ top: 1 }), { top: 1 }, 'flat key unchanged')
console.log('PASS: unflatten restores arrays and objects')
