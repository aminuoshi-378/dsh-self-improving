const { flatten } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
function throwsCircular(fn) {
  try { fn(); return false } catch (e) { return e.message === 'CIRCULAR' }
}
eqJson(flatten({ a: { b: { c: 1 } }, d: [1, 2] }), { 'a.b.c': 1, d: [1, 2] }, 'arrays stay whole')
eqJson(flatten({ a: 1 }), { a: 1 }, 'flat object')
eqJson(flatten({}), {}, 'empty object')
eqJson(flatten({ a: { b: 1 } }, 'x'), { 'x.a.b': 1 }, 'prefix prepends')
eqJson(flatten({ a: [{ b: 1 }] }), { a: [{ b: 1 }] }, 'array leaf with object inside')
eqJson(flatten({ a: { b: [1, { c: 2 }] } }), { 'a.b': [1, { c: 2 }] }, 'nested array leaf')
const cyclic = { a: 1 }
cyclic.self = cyclic
if (!throwsCircular(() => flatten(cyclic))) {
  console.error('FAIL cycle must throw CIRCULAR')
  process.exit(1)
}
console.log('PASS: flatten keeps arrays, guards cycles')
