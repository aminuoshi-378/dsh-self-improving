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
const lines = ['aa','bb','aa','cc','aa','bb','aa']
const fs = new MemFS()
const deds = []
for (const l of lines) deds.push(appendDedup(fs, 'raw.txt', l, 4))
eqHash(JSON.stringify({ deds, raw: fs.readFile('raw.txt') }), '80713f795f0b52346d0e26c1de2a0fcdfc3019f70c31f5ce7312b7ce96eb9694', 'trailing-window dedup')
const fs2 = new MemFS()
fs2.writeFile('log', 'l1\nl2\nl3')
fs2.writeFile('log.1', 'old1')
fs2.writeFile('log.2', 'older2')
rotate(fs2, 'log', 2)
eqHash(JSON.stringify(fs2.list().map((n) => [n, fs2.readFile(n)])), '518ff9e64af2fb6e32209477af60dcf36f976d20c3db78d11b739fd62eb35550', 'rotate shifts oldest-first and drops the last generation')
const fs3 = new MemFS()
const logResults = []
for (const l of ['r1','r2','r3','r4','r5','r1','r6','r7','r8']) {
  logResults.push([l, appendLog(fs3, 'svc', { maxLines: 4, keep: 2, window: 4 }, l)])
}
eqHash(JSON.stringify(logResults), '386ae875a0568dd98e0cfc069246483c156f590f0215ba0a67f403a32cce4e5e', 'logger rotate-then-append decisions')
eqHash(JSON.stringify(fs3.list().map((n) => [n, fs3.readFile(n)])), 'd0570b0dda85abac30ef97e1ec7087ef46fef6c96a3acdde6c1dcb4d13d6ff29', 'logger file states')
console.log('PASS: log system end to end')
