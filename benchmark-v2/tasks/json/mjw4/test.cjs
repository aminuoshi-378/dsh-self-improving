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
  const m = require('./document')
  const fns = ["createDocument"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./document.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./patch')
  const fns = ["applyPatch"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./patch.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./paths')
  const fns = ["parsePath", "getPath"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./paths.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { createDocument } = require('./document.js')
const { getPath } = require('./paths.js')
const { applyPatch } = require('./patch.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
const doc = createDocument({'m':[[1,2],[3,4]]})
doc.apply([{'op':'set','path':'m[0][1]','value':20},{'op':'remove','path':'m[1]'},{'op':'add','path':'m','value':[5,6]}])
eqHash(JSON.stringify(doc.toJSON()), 'a02b1c6e6fdbc3a4812edab893abc6dbb93614806b653e48f0e4cb87bd3caf1c', 'patched document state')
eqHash(JSON.stringify(['m[0][0]','m[0][1]','m[1][0]','m[1][1]','m[2][0]'].map((p) => doc.get(p))), '72af22a8589afdb66e26db8625a102dcf23be0a629563ac34dd845b9659d7eec', 'document reads')
const raw = {'m':[[1,2],[3,4]]}
applyPatch(raw, [{'op':'set','path':'m[0][1]','value':20},{'op':'remove','path':'m[1]'},{'op':'add','path':'m','value':[5,6]}])
eqHash(JSON.stringify(['m[0][0]','m[0][1]','m[1][0]','m[1][1]','m[2][0]'].map((p) => getPath(raw, p, 'MISS'))), 'ed8e717e70fcbdaaa2a3486b169d3bcf0810463a3f1b33e74f188f01b6e0c1a3', 'paths + patch directly')
console.log('PASS: document engine end to end')
