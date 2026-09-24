const { validate } = require('./bug.cjs')
function count(actual, n, msg) {
  if (!Array.isArray(actual) || actual.length !== n) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}`)
    process.exit(1)
  }
}
count(validate(true, { type: 'boolean' }), 0, 'boolean ok')
count(validate(false, { type: 'boolean' }), 0, 'false ok')
count(validate(null, { type: 'string', nullable: true }), 0, 'nullable string')
count(validate('s', { type: 'null' }), 1, 'wrong target type')
const multi = validate({}, { type: 'object', required: ['a', 'b', 'c'] })
count(multi, 3, 'three missing required keys')
const arrNest = validate([[1], ['x']], { type: 'array', items: { type: 'array', items: { type: 'number' } } })
count(arrNest, 1, 'nested array item type')
if (!arrNest[0].includes('[1].')) {
  console.error(`FAIL nested array prefix: ${arrNest[0]}`)
  process.exit(1)
}
count(validate([], { type: 'array', minItems: 1 }), 1, 'empty array under minItems')
const deep = validate({ a: { b: { c: 'wrong' } } }, {
  type: 'object',
  properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'number' } } } } } },
})
count(deep, 1, 'three-level property error')
if (!deep[0].includes('a.b.c')) {
  console.error(`FAIL three-level prefix: ${deep[0]}`)
  process.exit(1)
}
count(validate({ a: { b: 1 } }, { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'number' } } } } }), 0, 'valid nesting passes')
console.log('PASS: nested schema validation (held-out)')
