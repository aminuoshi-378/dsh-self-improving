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
// Interface stability: module surface must stay require-compatible.
{
  const m = require('./etl')
  const fns = ["runETL"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./etl.js must still export ${fn}`)
    process.exit(1)
  }
}
{
  const m = require('./pipeline')
  const fns = ["runPipeline"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./pipeline.js must still export ${fn}`)
    process.exit(1)
  }
}
{
  const m = require('./pool')
  const fns = ["mapLimit"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./pool.js must still export ${fn}`)
    process.exit(1)
  }
}
const { runETL } = require('./etl.js')
const { runPipeline } = require('./pipeline.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
;(async () => {
  const records = [{'id':'a','qty':2,'unitPrice':3},{'id':'b','qty':1,'unitPrice':10,'discount':0.5},{'id':'c','qty':0,'unitPrice':5},{'id':'d','qty':4,'unitPrice':1,'discount':0.25}]
  const etl = await runETL(records.map((r) => ({ ...r })), {'readConcurrency':2,'computeConcurrency':3})
  eqHash(JSON.stringify(etl), '78734a41c51400c80a61f18e9149c87572584e3ed23de084eb954ff81164b182', 'etl pipeline with failures dropping slots')
  const plain = await runPipeline([{ concurrency: 2, fn: (v) => v * 2 }, { concurrency: 1, fn: (v) => v + 1 }], [1,2,3,4])
  eqHash(JSON.stringify(plain), '01c334964c0798ba159674bd7b109b9d155672c69875d5b9c39f0f103799e27b', 'stage outputs feed the next stage')
  console.log('PASS: pipeline stages chain and drop failures')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
