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
  const m = require('./format')
  const fns = ["formatAbbr", "formatDayNumber"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./format.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./parse')
  const fns = ["parseAny"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./parse.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./shift')
  const fns = ["addDays", "addMonthsClamped", "startOfWeek"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./shift.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { parseAny } = require('./parse.js')
const { addDays, addMonthsClamped, startOfWeek } = require('./shift.js')
const { formatAbbr, formatDayNumber } = require('./format.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
eqHash(JSON.stringify(['2023-02-29', '29/02/2024', '20241231', '00/05/2024'].map(parseAny)), '406a230ff28a4e80aa3dd628a5e2c39e0e89841f19420fe691fdde36f1096e9a', 'parseAny validates real dates')
const op = ['addMonthsClamped', '2024-01-31', 2]
if (op[0] === 'addDays') eqJson(addDays(op[1], op[2]), "2024-03-31", 'addDays')
else if (op[0] === 'addMonthsClamped') eqJson(addMonthsClamped(op[1], op[2]), "2024-03-31", 'addMonthsClamped')
else eqJson(startOfWeek(op[1]), "2024-03-31", 'startOfWeek returns Monday')
eqHash(JSON.stringify(['2024-09-30', '1970-01-01', '1999-12-31'].map(formatAbbr)), '838a969df6589cb7c421d7ebb310812539305b3b414a4a85433e613e739c5ffc', 'formatAbbr month abbreviations')
eqHash(JSON.stringify(['2024-09-30', '1970-01-01', '1999-12-31'].map(formatDayNumber)), '05c1dfee788873a0cec1d1c13496838e4cd8d65ff853b723174794b2678cadc5', 'formatDayNumber counts UTC days')
console.log('PASS: date stack end to end')
