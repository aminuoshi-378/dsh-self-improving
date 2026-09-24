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
const fs = new TreeFS({'deep/one/two/f.js':'1','deep/one/f.js':'2','deep/f.js':'3','f.js':'4'})
const pats = ['deep/one/two/f.js','deep/*/f.js','f.js','*.js','deep/*.js']
eqHash(JSON.stringify(pats.map((p) => find(fs, p))), '423df514618a2248ec0df5bdb0eea4287786ea007cad0d8810bdae1f15248c2c', 'find applies full-path glob semantics')
eqHash(JSON.stringify(pats.map((p) => [p, fs.paths().filter((path) => matchGlob(p, path))])), '41f54e4b0fca25837c6fc58fa595926c005e7fa1a5a9e9c89dab4d8700d2f147', 'glob: * stops at slashes, ? is one char')
eqHash(JSON.stringify(['', 'src', 'app', 'b', 'deep', 'x'].map((pre) => [pre, walkAll(fs, pre)])), 'd999ae6b85569dedb032b220b1b3b6ce6f5d91de4e08aeb0bf3b760b512fce6f', 'walk anchors the directory prefix')
console.log('PASS: finder end to end')
