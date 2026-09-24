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
const INPUT = '\u{1F468}\u200D\u{1F4BB} dev'
eqHash(JSON.stringify(cleanTokens(INPUT)), 'bce6d1e28fc41fb5ff1985fbfdc6549339962fb7a7c397c19819fddc1986a096', 'cleanTokens normalizes then segments')
eqHash(JSON.stringify(renderTokens(["👨", "💻", " ", "d", "e", "v"])), 'e3485b03373dae42047449a3bb7043382b1e56d572f25fec77302a7bc5364d56', 'renderTokens joins the clusters')
eqHash(JSON.stringify(clean(INPUT)), 'e3485b03373dae42047449a3bb7043382b1e56d572f25fec77302a7bc5364d56', 'clean runs the whole pipeline')
eqHash(JSON.stringify(graphemes(normalizeKeepCase(INPUT))), 'bce6d1e28fc41fb5ff1985fbfdc6549339962fb7a7c397c19819fddc1986a096', 'layered calls agree')
console.log('PASS: clean pipeline end to end')
