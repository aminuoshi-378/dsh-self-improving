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
eqHash(JSON.stringify(['2024-05-01', '31/12/2024', '20240301', '2024-13-01'].map(parseAny)), '2be28c835ae2950b91e3cd81cefbd15084a2ceb0792aa59b2223634b20a37553', 'parseAny validates real dates')
const op = ['addDays', '2024-01-01', 5]
if (op[0] === 'addDays') eqJson(addDays(op[1], op[2]), "2024-01-06", 'addDays')
else if (op[0] === 'addMonthsClamped') eqJson(addMonthsClamped(op[1], op[2]), "2024-01-06", 'addMonthsClamped')
else eqJson(startOfWeek(op[1]), "2024-01-06", 'startOfWeek returns Monday')
eqHash(JSON.stringify(['2024-09-05', '1969-12-31', '2000-02-29'].map(formatAbbr)), '77310552ead861ec99d4c5723425253ea4e6220efe5734cda48733ec504cea9f', 'formatAbbr month abbreviations')
eqHash(JSON.stringify(['2024-09-05', '1969-12-31', '2000-02-29'].map(formatDayNumber)), '8bee5924b4ad17cd2a68a7a8f12b81fb0447eb8cac6c1d214573ef585cd8661f', 'formatDayNumber counts UTC days')
console.log('PASS: date stack end to end')
