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
  const m = require('./calendar')
  const fns = ["expand"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./calendar.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./core')
  const fns = ["parseUTC", "toISO", "clampedAdd"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./core.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./recurrence')
  const fns = ["nextOccurrences"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./recurrence.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { nextOccurrences } = require('./recurrence.js')
const { expand } = require('./calendar.js')
const { clampedAdd } = require('./core.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
const RULE = {'kind':'DAILY','step':7}
const FROM = '2024-02-25'
eqHash(JSON.stringify(nextOccurrences(RULE, FROM, 3)), '0954757791bb9f93cb420ee6fec6631ffa44a2b2e0c042fd82e84897114e9575', 'recurrence expands in order')
eqHash(JSON.stringify(expand(RULE, FROM, 3)), '0954757791bb9f93cb420ee6fec6631ffa44a2b2e0c042fd82e84897114e9575', 'calendar expansion is sorted and exact-length')
if (expand(RULE, FROM, 3).length !== 3) { console.error('FAIL limit respected'); process.exit(1) }
const first = expand(RULE, FROM, 3)[0]
if (!(first > FROM)) { console.error('FAIL occurrences are strictly after fromISO'); process.exit(1) }
console.log('PASS: calendar stack end to end')
