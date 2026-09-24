const { validate } = require('./bug.cjs')
function count(actual, n, msg) {
  if (!Array.isArray(actual) || actual.length !== n) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}`)
    process.exit(1)
  }
}
count(validate('x', { type: 'string' }), 0, 'string ok')
count(validate(1, { type: 'string' }), 1, 'wrong scalar type')
count(validate(null, { type: 'object', nullable: true }), 0, 'nullable null')
count(validate(null, { type: 'object' }), 1, 'null not nullable')
count(validate([], { type: 'array' }), 0, 'array type ok')
count(validate([1], { type: 'array' }), 0, 'array with element ok')
count(validate({ id: 'a' }, { type: 'object', required: ['id'] }), 0, 'required present')
const missing = validate({}, { type: 'object', required: ['id'] })
count(missing, 1, 'required missing count')
if (!missing[0].includes('required')) {
  console.error(`FAIL required error should mention 'required': ${missing[0]}`)
  process.exit(1)
}
const items = validate([1, 'a'], { type: 'array', items: { type: 'number' } })
count(items, 1, 'one bad element')
if (!items[0].includes('[1]')) {
  console.error(`FAIL element error should be indexed: ${items[0]}`)
  process.exit(1)
}
count(validate([1, 2], { type: 'array', minItems: 3 }), 1, 'minItems')
count(validate([1, 2], { type: 'array', minItems: 0 }), 0, 'minItems 0')
const nested = validate({ u: { name: 1 } }, {
  type: 'object',
  properties: { u: { type: 'object', properties: { name: { type: 'string' } } } },
})
count(nested, 1, 'nested property error count')
if (!nested[0].includes('u.name')) {
  console.error(`FAIL nested error should be prefixed 'u.name': ${nested[0]}`)
  process.exit(1)
}
count(validate({ extra: 1 }, { type: 'object' }), 0, 'unlisted keys allowed')
console.log('PASS: schema validation with nesting')
