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
const INPUT = 'x\u{1F1FA}\u{1F1F8}y'
const W = 2
const lines = wrapToWidth(INPUT, W)
for (const line of lines) {
  if (displayWidth(line) > W) {
    console.error(`FAIL wrapped line too wide: ${JSON.stringify(line)} (${displayWidth(line)} > ${W})`)
    process.exit(1)
  }
}
eqHash(JSON.stringify(lines), '3c970cd1fdcccfbc72207332f191e4fbc522d9c087e5afc8e208b6715b01f511', 'wrap lines by display width')
eqHash(JSON.stringify(alignLines(lines, W, 'left')), '4fbe85e564c2494af21088292d35d80336badbd53aa40ad3aef5ab985522fce1', 'left align')
eqHash(JSON.stringify(alignLines(lines, W, 'right')), 'de5ec350b33edd76758748bef2ceb4e8fa01c1b73e2a804f6981c926465d2cf7', 'right align')
eqHash(JSON.stringify(alignLines(lines, W, 'center')), 'de5ec350b33edd76758748bef2ceb4e8fa01c1b73e2a804f6981c926465d2cf7', 'center align, extra space on the left')
const joined = alignLines(lines, W, 'left').map((l) => l.length).every((n) => n === 0 || displayWidth('') === 0 || n > 0)
if (!alignLines(lines, W, 'center').every((l) => displayWidth(l) === W)) {
  console.error('FAIL centered lines must reach exact width')
  process.exit(1)
}
console.log('PASS: wrap and align engine')
