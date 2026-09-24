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
eqHash(JSON.stringify(['2024-02-30', '28/02/2023', '20240229', '2024-2-5'].map(parseAny)), 'cff0608a3782d2526a648e9eb575e0425f1a589529255338461db1ab8a49a651', 'parseAny validates real dates')
const op = ['startOfWeek', '2024-01-07']
if (op[0] === 'addDays') eqJson(addDays(op[1], op[2]), "2024-01-01", 'addDays')
else if (op[0] === 'addMonthsClamped') eqJson(addMonthsClamped(op[1], op[2]), "2024-01-01", 'addMonthsClamped')
else eqJson(startOfWeek(op[1]), "2024-01-01", 'startOfWeek returns Monday')
eqHash(JSON.stringify(['2024-02-29', '2024-02-28', '2020-01-01'].map(formatAbbr)), 'a575a4f439503515715e027e51efa13b2bff18397de205fa2ffd5a10919b5937', 'formatAbbr month abbreviations')
eqHash(JSON.stringify(['2024-02-29', '2024-02-28', '2020-01-01'].map(formatDayNumber)), '0cfa4f9f5010c815e09cfc624ac9a8f6a2fb673ea661c33293049b438068462c', 'formatDayNumber counts UTC days')
console.log('PASS: date stack end to end')
