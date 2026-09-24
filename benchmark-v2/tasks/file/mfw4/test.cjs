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
  const m = require('./dedup')
  const fns = ["appendDedup"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./dedup.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./logger')
  const fns = ["appendLog"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./logger.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./rotate')
  const fns = ["rotate"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./rotate.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./vfs')
  const fns = ["MemFS"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./vfs.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { MemFS } = require('./vfs.js')
const { appendDedup } = require('./dedup.js')
const { rotate } = require('./rotate.js')
const { appendLog } = require('./logger.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
const lines = ['p','q','p','r','p','s','p']
const fs = new MemFS()
const deds = []
for (const l of lines) deds.push(appendDedup(fs, 'raw.txt', l, 3))
eqHash(JSON.stringify({ deds, raw: fs.readFile('raw.txt') }), 'd982fb7ef4f5a01e25ba7793d9716ceb1f9a0540e2f1363f42f8c65def19e8fd', 'trailing-window dedup')
const fs2 = new MemFS()
fs2.writeFile('log', 'l1\nl2\nl3')
fs2.writeFile('log.1', 'old1')
fs2.writeFile('log.2', 'older2')
rotate(fs2, 'log', 1)
eqHash(JSON.stringify(fs2.list().map((n) => [n, fs2.readFile(n)])), '47afd6e1df90ff7292f25f81e75be1760e7dce9089db2178f98d1a7f7468225d', 'rotate shifts oldest-first and drops the last generation')
const fs3 = new MemFS()
const logResults = []
for (const l of ['r1','r2','r3','r4','r5','r1','r6','r7','r8']) {
  logResults.push([l, appendLog(fs3, 'svc', { maxLines: 3, keep: 1, window: 3 }, l)])
}
eqHash(JSON.stringify(logResults), '386ae875a0568dd98e0cfc069246483c156f590f0215ba0a67f403a32cce4e5e', 'logger rotate-then-append decisions')
eqHash(JSON.stringify(fs3.list().map((n) => [n, fs3.readFile(n)])), 'e405391d7a1f7b02b91cac07a7324a40ad85224a5b662a8f34b11f86fd9d9463', 'logger file states')
console.log('PASS: log system end to end')
