const { stableStringify } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}:\n  got  ${JSON.stringify(actual)}\n  want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

const a = stableStringify({ b: 1, a: { d: 2, c: 3 } })
const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 })
eq(a, b, 'key order does not change the output')
eq(a, '{"a":{"c":3,"d":2},"b":1}', 'keys are recursively sorted, no spaces')
eq(stableStringify([2, 1]), '[2,1]', 'arrays keep their order')
eq(stableStringify(5), '5', 'primitive passthrough')
eq(JSON.stringify(JSON.parse(a)), JSON.stringify({ a: { c: 3, d: 2 }, b: 1 }), 'round-trips to the same value')
console.log('PASS: stableStringify is order-independent')
