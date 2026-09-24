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
eqHash(JSON.stringify(['2020-02-29', '29/02/2020', '20200229', '29/02/2023'].map(parseAny)), '682e52aecf60c6561891f973b0822be80d3375cf9bddfd8ad67ef47e73216ad3', 'parseAny validates real dates')
const op = ['addMonthsClamped', '2024-03-31', -1]
if (op[0] === 'addDays') eqJson(addDays(op[1], op[2]), "2024-02-29", 'addDays')
else if (op[0] === 'addMonthsClamped') eqJson(addMonthsClamped(op[1], op[2]), "2024-02-29", 'addMonthsClamped')
else eqJson(startOfWeek(op[1]), "2024-02-29", 'startOfWeek returns Monday')
eqHash(JSON.stringify(['2000-01-01', '1969-07-20', '2024-11-05'].map(formatAbbr)), '0bdb3703471f3fe289b37ee73a987210c55c835c4543acb8623e40bb19080061', 'formatAbbr month abbreviations')
eqHash(JSON.stringify(['2000-01-01', '1969-07-20', '2024-11-05'].map(formatDayNumber)), '5b91c5b3a43b1d8330a66158d492b040a4e6ca74ab97c12e21b8ea0a51572cb2', 'formatDayNumber counts UTC days')
console.log('PASS: date stack end to end')
