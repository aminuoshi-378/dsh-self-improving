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
  const m = require('./find')
  const fns = ["find"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./find.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./pattern')
  const fns = ["matchGlob"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./pattern.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./vfs')
  const fns = ["TreeFS"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./vfs.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./walk')
  const fns = ["walkAll"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./walk.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { TreeFS } = require('./vfs.js')
const { matchGlob } = require('./pattern.js')
const { walkAll } = require('./walk.js')
const { find } = require('./find.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
const fs = new TreeFS({'a.txt':'1','ab.txt':'2','b/a.txt':'3','b/c/a.txt':'4'})
const pats = ['a.txt','?.txt','*.txt','b/*/a.txt','b/a.txt']
eqHash(JSON.stringify(pats.map((p) => find(fs, p))), 'b357a67ad24ce21650b78494f723f70cd8c8af28d2f079d8833ee20397e54f0a', 'find applies full-path glob semantics')
eqHash(JSON.stringify(pats.map((p) => [p, fs.paths().filter((path) => matchGlob(p, path))])), '8a98df630be47e6ff31527bfc1fae0f39b6d75834c60a3924c774522ef542fa9', 'glob: * stops at slashes, ? is one char')
eqHash(JSON.stringify(['', 'src', 'app', 'b', 'deep', 'x'].map((pre) => [pre, walkAll(fs, pre)])), '006de908271b21dcff98695b8bece4f56acc64a3f8ab314586dae9cad4ffd137', 'walk anchors the directory prefix')
console.log('PASS: finder end to end')
