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
const doc = createDocument({'user':{'name':'ada','tags':['x']}})
doc.apply([{'op':'add','path':'user.tags','value':'y'},{'op':'remove','path':'user.name'},{'op':'set','path':'user.age','value':36}])
eqHash(JSON.stringify(doc.toJSON()), '3938fcca43d5ebb96146cc32f85e04fce530a423d6f789fdba0b5223ee23aad1', 'patched document state')
eqHash(JSON.stringify(['user.name','user.age','user.tags[0]','user.tags[1]','user.tags[2]'].map((p) => doc.get(p))), '73a1ce31618ef4c576d562a6fb862f135d3c5a6e48879072618afdc6ed5ec843', 'document reads')
const raw = {'user':{'name':'ada','tags':['x']}}
applyPatch(raw, [{'op':'add','path':'user.tags','value':'y'},{'op':'remove','path':'user.name'},{'op':'set','path':'user.age','value':36}])
eqHash(JSON.stringify(['user.name','user.age','user.tags[0]','user.tags[1]','user.tags[2]'].map((p) => getPath(raw, p, 'MISS'))), '893a9c85e0b1858661f4dfeca08315e78d73359fba944160058d1c7ed55a7e8b', 'paths + patch directly')
console.log('PASS: document engine end to end')
