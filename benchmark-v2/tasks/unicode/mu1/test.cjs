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
  const m = require('./normalize')
  const fns = ["normalizeKeepCase"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./normalize.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./pipeline')
  const fns = ["cleanTokens", "renderTokens", "clean"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./pipeline.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
{
  const m = require('./tokenize')
  const fns = ["graphemes"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./tokenize.js must still export ${fn} — keep the module surface require-compatible`)
    process.exit(1)
  }
}
const { cleanTokens, renderTokens, clean } = require('./pipeline.js')
const { normalizeKeepCase } = require('./normalize.js')
const { graphemes } = require('./tokenize.js')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
const INPUT = 'cafe\u0301 menu'
eqHash(JSON.stringify(cleanTokens(INPUT)), 'dee4a3b27c9df5bf804cf781db7d159eeeaa7030b464c27b0fb496ac1097e291', 'cleanTokens normalizes then segments')
eqHash(JSON.stringify(renderTokens(["c", "a", "f", "é", " ", "m", "e", "n", "u"])), 'fe5f72077d423784fcf6eff98041ba2bd360235aaa09997d0fdcd89271db0884', 'renderTokens joins the clusters')
eqHash(JSON.stringify(clean(INPUT)), 'fe5f72077d423784fcf6eff98041ba2bd360235aaa09997d0fdcd89271db0884', 'clean runs the whole pipeline')
eqHash(JSON.stringify(graphemes(normalizeKeepCase(INPUT))), 'dee4a3b27c9df5bf804cf781db7d159eeeaa7030b464c27b0fb496ac1097e291', 'layered calls agree')
console.log('PASS: clean pipeline end to end')
