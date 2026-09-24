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
  const m = require('./layout')
  const fns = ["alignLines"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./layout.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./width')
  const fns = ["displayWidth"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./width.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./wrap')
  const fns = ["wrapToWidth"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./wrap.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { wrapToWidth } = require('./wrap.js')
const { alignLines } = require('./layout.js')
const { displayWidth } = require('./width.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
const INPUT = 'aa bb cc dd'
const W = 3
const lines = wrapToWidth(INPUT, W)
for (const line of lines) {
  if (displayWidth(line) > W) {
    console.error(`FAIL wrapped line too wide: ${JSON.stringify(line)} (${displayWidth(line)} > ${W})`)
    process.exit(1)
  }
}
eqHash(JSON.stringify(lines), 'd203c3b25743fcb06b7ad69a7246b94b55a91f0e4ae171b67647313e7bc080c3', 'wrap lines by display width')
eqHash(JSON.stringify(alignLines(lines, W, 'left')), 'a547a35401d47e081218bd8a3e765994d2e426746c79ee823f6013ce037c60c1', 'left align')
eqHash(JSON.stringify(alignLines(lines, W, 'right')), 'eb0e7abd4c9eea3536858c27ebd5b6d40be931f9ffd2520ca2f2bf84c091d69e', 'right align')
eqHash(JSON.stringify(alignLines(lines, W, 'center')), 'eb0e7abd4c9eea3536858c27ebd5b6d40be931f9ffd2520ca2f2bf84c091d69e', 'center align, extra space on the left')
const joined = alignLines(lines, W, 'left').map((l) => l.length).every((n) => n === 0 || displayWidth('') === 0 || n > 0)
if (!alignLines(lines, W, 'center').every((l) => displayWidth(l) === W)) {
  console.error('FAIL centered lines must reach exact width')
  process.exit(1)
}
console.log('PASS: wrap and align engine')
