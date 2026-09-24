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
eqJson(flatten({ a: { b: { c: { d: 1 } } }, e: 2, f: { g: [3] } }),
  { 'a.b.c.d': 1, e: 2, 'f.g': [3] }, 'deep and sibling subtrees')
eqJson(flatten({ x: { y: {} } }), {}, 'empty inner object flattens away')
const deep = { a: { b: 1 }, c: { d: { e: { f: 2 } } } }
eqJson(flatten(deep), { 'a.b': 1, 'c.d.e.f': 2 }, 'uneven depth')
const cyc = { a: { b: { c: 1 } } }
cyc.a.b.back = cyc
if (!throwsCircular(() => flatten(cyc))) {
  console.error('FAIL deep cycle must throw CIRCULAR')
  process.exit(1)
}
const shared = { s: 1 }
eqJson(flatten({ p: shared, q: shared }), { 'p.s': 1, 'q.s': 1 }, 'shared non-cyclic object is fine')
console.log('PASS: flatten deep trees, shared refs, cycles (held-out)')
