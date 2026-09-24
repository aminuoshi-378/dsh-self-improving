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
const fs = new TreeFS({'src/a.js':'1','src/b.js':'2','src/sub/c.js':'3','doc.md':'4','srcx/d.js':'5'})
const pats = ['src/*.js','*','doc.??','src/sub/*.js','*.js']
eqHash(JSON.stringify(pats.map((p) => find(fs, p))), '2f3e3277b38f571a16bad6125e16c33a697d8ba541c5291149c797a64592e06b', 'find applies full-path glob semantics')
eqHash(JSON.stringify(pats.map((p) => [p, fs.paths().filter((path) => matchGlob(p, path))])), '31fdccbd72ef80462cc3e6561293cdf0e2151567ae80045482eb215f7271e743', 'glob: * stops at slashes, ? is one char')
eqHash(JSON.stringify(['', 'src', 'app', 'b', 'deep', 'x'].map((pre) => [pre, walkAll(fs, pre)])), '65cab67e0faf56d4ea13b68221e8c3d96ea49a57c22634a1d200c416f10e6a50', 'walk anchors the directory prefix')
console.log('PASS: finder end to end')
