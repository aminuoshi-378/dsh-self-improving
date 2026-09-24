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
const fs = new TreeFS({'app/main.js':'1','app/lib/x.js':'2','app/lib/deep/y.js':'3','main.js':'4'})
const pats = ['main.js','app/*.js','app/?.js','*/main.js','app/lib/deep/y.js']
eqHash(JSON.stringify(pats.map((p) => find(fs, p))), 'a902df4d339a2d2d21a9d562f6f707b8ba9c175e99de3274d2bfdbfd4a9847d5', 'find applies full-path glob semantics')
eqHash(JSON.stringify(pats.map((p) => [p, fs.paths().filter((path) => matchGlob(p, path))])), '5a6add489287e2fee94dc98ee85e2d77d8f2edd98d172d1b1e6bbe5afaa1041a', 'glob: * stops at slashes, ? is one char')
eqHash(JSON.stringify(['', 'src', 'app', 'b', 'deep', 'x'].map((pre) => [pre, walkAll(fs, pre)])), '110f2d0d14c5ed3a24fcfca599deeedbbb4db8616be0e89437092b10963dbca8', 'walk anchors the directory prefix')
console.log('PASS: finder end to end')
