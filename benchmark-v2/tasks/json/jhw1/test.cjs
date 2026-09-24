const { getPath } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(getPath({ a: { b: 1 } }, 'a.b', 'M'), 1, 'dotted object path')
eq(getPath({ items: [{ x: 7 }] }, 'items[0].x', 'M'), 7, 'array index step')
eq(getPath({ m: [[1, 2], [3, 4]] }, 'm[1][0]', 'M'), 3, 'nested array indices')
eq(getPath({}, 'a.b', 'M'), 'M', 'missing key')
eq(getPath({ a: [1, 2] }, 'a[5]', 'M'), 'M', 'index out of range')
eq(getPath({ a: [1, 2] }, 'a[-1]', 'M'), 'M', 'negative index')
eq(getPath({ a: { b: null } }, 'a.b.c', 'M'), 'M', 'null intermediate')
eq(getPath({ k0: { 0: { z: 1 } } }, 'k0.0.z', 'M'), 1, 'numeric object key')
eq(getPath({ a: 'str' }, 'a.length', 'M'), 'M', 'primitive intermediate yields fallback')
eq(getPath({ a: { b: undefined } }, 'a.b', 'M'), 'M', 'undefined leaf yields fallback')
console.log('PASS: dotted path with array indexing')
