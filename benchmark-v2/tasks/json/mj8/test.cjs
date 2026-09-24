// Grading: golden-hash assertions. Expected values are committed as SHA-256
// digests; the visible contract is the assertion message only.
const crypto = require('node:crypto')
function eqHash(actualJson, expectedSha, msg) {
  const h = crypto.createHash('sha256').update(actualJson).digest('hex')
  if (h !== expectedSha) {
    console.error(`FAIL ${msg} (got hash ${h.slice(0, 12)}, expected ${expectedSha.slice(0, 12)})`)
    process.exit(1)
  }
}
function countHash(actualList, expectedSha, msg) {
  const n = Array.isArray(actualList) ? actualList.length : -1
  const h = crypto.createHash('sha256').update(String(n)).digest('hex')
  if (h !== expectedSha) {
    console.error(`FAIL ${msg} (count hash ${h.slice(0, 12)}, expected ${expectedSha.slice(0, 12)})`)
    process.exit(1)
  }
}
// Interface stability: the module surface must stay require-compatible.
{
  const m = require('./coerce')
  const fns = ["coerceValue"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./coerce.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./form')
  const fns = ["buildForm"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./form.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./validate')
  const fns = ["validate"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./validate.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { buildForm } = require('./form.js')
const { coerceValue } = require('./coerce.js')
const { validate } = require('./validate.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
eqHash(JSON.stringify(buildForm({'type':'object','required':['email'],'properties':{'email':{'type':'string'},'age':{'type':'number','default':'18'}}}, {'email':null,'age':'20'})), '6eef67715b919dc90732c128d6e15b519c4cb729b92ebf32a9cd3c4714cc74ad', 'buildForm value and errors')
eqHash(JSON.stringify([['true','boolean'],['TRUE','boolean'],['1','boolean'],['-3','number'],['3.5','number'],['x','number'],['txt','string']].map(([raw, ty]) => coerceValue(raw, ty))), '081bb7fa1d228a5d1732edeb026e50d000ea27ecd908f02987a5f2d704f2fc62', 'coerce strictness')
eqHash(JSON.stringify(validate({'email':null,'age':'20'}, {'type':'object','required':['email'],'properties':{'email':{'type':'string'},'age':{'type':'number','default':'18'}}})), '0d76c0b21faf322cd53f41d1e8f7266ecf642911dafe8ca4b7c72d1b0373ec19', 'validate on raw data')
console.log('PASS: form stack end to end')
