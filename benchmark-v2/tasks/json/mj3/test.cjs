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
const doc = createDocument({'env':{'prod':true},'hosts':[]})
doc.apply([{'op':'set','path':'env.staging','value':false},{'op':'add','path':'hosts','value':'h1'},{'op':'remove','path':'env.prod'}])
eqHash(JSON.stringify(doc.toJSON()), 'f1a8bfc87ecd4e659f0510bf91c15dac51b402006dbd92cb2f54d63858d1decf', 'patched document state')
eqHash(JSON.stringify(['env.prod','env.staging','hosts[0]','hosts[1]'].map((p) => doc.get(p))), 'c5e122cd758e83332c0708a5a5342e2d5c1c55a1f471f2c5df3bc9e857288247', 'document reads')
const raw = {'env':{'prod':true},'hosts':[]}
applyPatch(raw, [{'op':'set','path':'env.staging','value':false},{'op':'add','path':'hosts','value':'h1'},{'op':'remove','path':'env.prod'}])
eqHash(JSON.stringify(['env.prod','env.staging','hosts[0]','hosts[1]'].map((p) => getPath(raw, p, 'MISS'))), 'ccbd9f611764b727154af7193c359956bf8bb7ab685d60626bd546f06cce4eab', 'paths + patch directly')
console.log('PASS: document engine end to end')
