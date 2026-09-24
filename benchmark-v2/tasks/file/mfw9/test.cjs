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
const fs = new TreeFS({'x/y/z.md':'1','x/y.md':'2','xz/y/z.md':'3','z.md':'4'})
const pats = ['x/*.md','x/y/*.md','x*/*.md','?/*.md','*.md']
eqHash(JSON.stringify(pats.map((p) => find(fs, p))), '1dd38859eb36774b3e287e734479898edf78d0840f2e5cae80d8870dce914042', 'find applies full-path glob semantics')
eqHash(JSON.stringify(pats.map((p) => [p, fs.paths().filter((path) => matchGlob(p, path))])), '199cea076ac3d625f47094e32eab932c844a168770668a996124d7c41da4b153', 'glob: * stops at slashes, ? is one char')
eqHash(JSON.stringify(['', 'src', 'app', 'b', 'deep', 'x'].map((pre) => [pre, walkAll(fs, pre)])), '07b4e0ae32ab7374faee8d98b2c387a91987e0b81f0ba3a8ccbb753bba4284e8', 'walk anchors the directory prefix')
console.log('PASS: finder end to end')
