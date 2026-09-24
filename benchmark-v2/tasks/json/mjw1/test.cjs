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
const doc = createDocument({'a':{'b':[{'x':1},{'x':2}]}})
doc.apply([{'op':'set','path':'a.b[1].x','value':9},{'op':'add','path':'a.b','value':{'x':3}},{'op':'remove','path':'a.b[0]'}])
eqHash(JSON.stringify(doc.toJSON()), '5bdd1ff0cdb7eaf45f058f07b6ccda827af7547487c6bb92e10415ecf33a8659', 'patched document state')
eqHash(JSON.stringify(['a.b[0].x','a.b[1].x','a.b[2].x','a.zz','a.b[5]'].map((p) => doc.get(p))), '06498ec8eed801db1915bbbd80759e5ca6871e9672044cde16f9ad39ebf09c4d', 'document reads')
const raw = {'a':{'b':[{'x':1},{'x':2}]}}
applyPatch(raw, [{'op':'set','path':'a.b[1].x','value':9},{'op':'add','path':'a.b','value':{'x':3}},{'op':'remove','path':'a.b[0]'}])
eqHash(JSON.stringify(['a.b[0].x','a.b[1].x','a.b[2].x','a.zz','a.b[5]'].map((p) => getPath(raw, p, 'MISS'))), 'f765505a88e9faf0eec53e4e8adad50530d7e8b42a7fa1b4ca8ba5bd03e93d63', 'paths + patch directly')
console.log('PASS: document engine end to end')
