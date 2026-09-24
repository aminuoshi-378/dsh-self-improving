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
const INPUT = '\u{1F1FA}\u{1F1F8} flags \u{1F1E6}\u{1F1F7}'
const W = 5
const lines = wrapToWidth(INPUT, W)
for (const line of lines) {
  if (displayWidth(line) > W) {
    console.error(`FAIL wrapped line too wide: ${JSON.stringify(line)} (${displayWidth(line)} > ${W})`)
    process.exit(1)
  }
}
eqHash(JSON.stringify(lines), 'c430e38027a54b332da026d7a4494201b40be771e5e74e609622ca87285d180d', 'wrap lines by display width')
eqHash(JSON.stringify(alignLines(lines, W, 'left')), '9d2f956e8d8e9abb4fdf501fbeb5edafd51dfe2dd49b8f73113ce7884d7752d2', 'left align')
eqHash(JSON.stringify(alignLines(lines, W, 'right')), '25c05635cfb49568d74da345fc784793e6e8a60becdcb5df030a7884737058b2', 'right align')
eqHash(JSON.stringify(alignLines(lines, W, 'center')), '175d030ae8c8f5a199274c7df5e5fddbfbad1ae10d2e673f1f3791b1c1d52e08', 'center align, extra space on the left')
const joined = alignLines(lines, W, 'left').map((l) => l.length).every((n) => n === 0 || displayWidth('') === 0 || n > 0)
if (!alignLines(lines, W, 'center').every((l) => displayWidth(l) === W)) {
  console.error('FAIL centered lines must reach exact width')
  process.exit(1)
}
console.log('PASS: wrap and align engine')
