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
const INPUT = 'e\u0301\u{1F600}hi world'
const W = 6
const lines = wrapToWidth(INPUT, W)
for (const line of lines) {
  if (displayWidth(line) > W) {
    console.error(`FAIL wrapped line too wide: ${JSON.stringify(line)} (${displayWidth(line)} > ${W})`)
    process.exit(1)
  }
}
eqHash(JSON.stringify(lines), '6811d1dc60c41e6ca82be0fc3c585c0c58c9522c2748535946db924092c5aea5', 'wrap lines by display width')
eqHash(JSON.stringify(alignLines(lines, W, 'left')), 'fd156d42f6480f9d3220dceb2696346c3a9f2b39cfd5325bad7629a27a01e75d', 'left align')
eqHash(JSON.stringify(alignLines(lines, W, 'right')), 'ae898b6bb3e0d2621234150c52924d26616d2ce65f29f76f0a603f1f7351f6cb', 'right align')
eqHash(JSON.stringify(alignLines(lines, W, 'center')), 'ae898b6bb3e0d2621234150c52924d26616d2ce65f29f76f0a603f1f7351f6cb', 'center align, extra space on the left')
const joined = alignLines(lines, W, 'left').map((l) => l.length).every((n) => n === 0 || displayWidth('') === 0 || n > 0)
if (!alignLines(lines, W, 'center').every((l) => displayWidth(l) === W)) {
  console.error('FAIL centered lines must reach exact width')
  process.exit(1)
}
console.log('PASS: wrap and align engine')
