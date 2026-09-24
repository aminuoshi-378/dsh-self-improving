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
const lines = ['1','2','3','4','5','6','7']
const fs = new MemFS()
const deds = []
for (const l of lines) deds.push(appendDedup(fs, 'raw.txt', l, 5))
eqHash(JSON.stringify({ deds, raw: fs.readFile('raw.txt') }), '97271c63cf76a94e266c7884bb69156d3cd2b069028d70010ede06f15e517728', 'trailing-window dedup')
const fs2 = new MemFS()
fs2.writeFile('log', 'l1\nl2\nl3')
fs2.writeFile('log.1', 'old1')
fs2.writeFile('log.2', 'older2')
rotate(fs2, 'log', 3)
eqHash(JSON.stringify(fs2.list().map((n) => [n, fs2.readFile(n)])), '42dde647023f2c78054f362e08d314ecba41cf98cd47718e12c8e96832201b37', 'rotate shifts oldest-first and drops the last generation')
const fs3 = new MemFS()
const logResults = []
for (const l of ['r1','r2','r3','r4','r5','r1','r6','r7','r8']) {
  logResults.push([l, appendLog(fs3, 'svc', { maxLines: 5, keep: 3, window: 5 }, l)])
}
eqHash(JSON.stringify(logResults), '37bc7b7c9711635f121534ae46afe1f837fa76755c71101b5c01d0f5590ae42a', 'logger rotate-then-append decisions')
eqHash(JSON.stringify(fs3.list().map((n) => [n, fs3.readFile(n)])), 'fc981b60b3a6520d4ca6d4c9592001b4246110e9cef0d24fa775cd442f8346c5', 'logger file states')
console.log('PASS: log system end to end')
