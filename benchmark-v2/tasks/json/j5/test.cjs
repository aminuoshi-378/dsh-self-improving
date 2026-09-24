const { mergeDeep } = require('./bug.cjs')

function deepEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}:\n  got  ${JSON.stringify(actual)}\n  want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

deepEq(mergeDeep({ x: { p: 1, q: 2 } }, { x: { p: 9 } }), { x: { p: 9, q: 2 } }, 'nested keys from both sides survive')
deepEq(mergeDeep({ list: [1, 2] }, { list: [3] }), { list: [3] }, 'arrays are replaced')
deepEq(mergeDeep({ a: 1 }, { a: 2, b: 3 }), { a: 2, b: 3 }, 'b wins scalars, adds keys')
deepEq(mergeDeep({ keep: 1 }, {}), { keep: 1 }, 'empty b is a no-op')
const inputA = { x: { p: 1, q: 2 } }
mergeDeep(inputA, { x: { p: 9 } })
deepEq(inputA, { x: { p: 1, q: 2 } }, 'inputs are not mutated')
console.log('PASS: mergeDeep merges objects, replaces arrays, mutates nothing')
