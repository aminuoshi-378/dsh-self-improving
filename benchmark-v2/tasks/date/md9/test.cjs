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
eqHash(JSON.stringify(['2024-00-10', '10/13/2024', '20241005', '2024-10-05x'].map(parseAny)), '9c407c6c7d23e19897d8d60ef0abad9c03042e783ea902d266e2edcc6c8ac59b', 'parseAny validates real dates')
const op = ['addDays', '2023-12-28', 7]
if (op[0] === 'addDays') eqJson(addDays(op[1], op[2]), "2024-01-04", 'addDays')
else if (op[0] === 'addMonthsClamped') eqJson(addMonthsClamped(op[1], op[2]), "2024-01-04", 'addMonthsClamped')
else eqJson(startOfWeek(op[1]), "2024-01-04", 'startOfWeek returns Monday')
eqHash(JSON.stringify(['2024-12-25', '1970-01-02', '2001-09-09'].map(formatAbbr)), 'b6b9dae019dbec1b0d48b79abe666643c0182b8a6f4cebd30fb2d4d03ca444cc', 'formatAbbr month abbreviations')
eqHash(JSON.stringify(['2024-12-25', '1970-01-02', '2001-09-09'].map(formatDayNumber)), 'f305589b7bc3e483d9c66bb5353a5d1e560de99ecd541484fed078e7c27c2e85', 'formatDayNumber counts UTC days')
console.log('PASS: date stack end to end')
