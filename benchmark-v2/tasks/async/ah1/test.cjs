const { mapLimit } = require('./bug.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
;(async () => {
  let cur = 0
  let max = 0
  const items = Array.from({ length: 20 }, (_, i) => (i === 3 || i === 14 ? 'bad' : i))
  const fn = async (v) => {
    cur++
    max = Math.max(max, cur)
    await sleep(4)
    cur--
    if (v === 'bad') throw new Error('bad@' + v)
    return v * 3
  }
  const { results, errors } = await mapLimit(items, 4, fn)
  eq(max <= 4, true, 'cap of 4 respected (saw ' + max + ')')
  eq(results.length, 20, 'result length')
  eq(results[0], 0, 'slot 0')
  eq(results[19], 57, 'slot 19')
  eq(results[3], undefined, 'failed slot is undefined')
  eq(errors.length, 2, 'two failures collected')
  const idx = errors.map((e) => e.index).sort((a, b) => a - b)
  eq(JSON.stringify(idx), JSON.stringify([3, 14]), 'failure indexes')
  const msgs = errors.map((e) => e.error.message)
  if (!msgs.every((m) => m === 'bad@bad')) {
    console.error('FAIL error messages: ' + JSON.stringify(msgs))
    process.exit(1)
  }
  for (let i = 0; i < 20; i++) {
    if (items[i] === 'bad') continue
    if (results[i] !== i * 3) {
      console.error(`FAIL slot ${i}: got ${results[i]}, want ${i * 3}`)
      process.exit(1)
    }
  }
  console.log('PASS: 20-item bounded run with two failures (held-out)')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
