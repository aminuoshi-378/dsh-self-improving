const { flatten } = require('./bug.cjs')

function deepEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}:\n  got  ${JSON.stringify(actual)}\n  want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

deepEq(
  flatten({ a: { b: 1 }, c: [2, 3], d: 5 }),
  { 'a.b': 1, 'c.0': 2, 'c.1': 3, d: 5 },
  'objects and arrays both flatten',
)
deepEq(
  flatten({ x: { y: { z: 1 } } }),
  { 'x.y.z': 1 },
  'deep nesting',
)
deepEq(flatten({ top: 1 }), { top: 1 }, 'flat object unchanged')
console.log('PASS: flatten handles objects and arrays with dot keys')
