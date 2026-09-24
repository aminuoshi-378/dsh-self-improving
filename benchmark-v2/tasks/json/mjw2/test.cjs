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
const doc = createDocument({'list':[]})
doc.apply([{'op':'add','path':'list','value':'one'},{'op':'add','path':'list','value':'two'},{'op':'set','path':'list[1]','value':'TWO'}])
eqHash(JSON.stringify(doc.toJSON()), '6a44e14bd46c55f0fc98dd63c700022f8c06e48cfc5acc7b4ec8e14b8fbd7382', 'patched document state')
eqHash(JSON.stringify(['list[0]','list[1]','list[2]','list[3]'].map((p) => doc.get(p))), 'baa8ddb98c8feff423955c0fd5c272a834312c745c2f1e6ab8278b2ad3dfa8f4', 'document reads')
const raw = {'list':[]}
applyPatch(raw, [{'op':'add','path':'list','value':'one'},{'op':'add','path':'list','value':'two'},{'op':'set','path':'list[1]','value':'TWO'}])
eqHash(JSON.stringify(['list[0]','list[1]','list[2]','list[3]'].map((p) => getPath(raw, p, 'MISS'))), '7067925febe36e8e3d69f906e4581789a264b6a81e49f270eb30953a4a4f8eed', 'paths + patch directly')
console.log('PASS: document engine end to end')
