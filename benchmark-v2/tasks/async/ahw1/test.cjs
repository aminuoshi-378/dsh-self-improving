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
  const fn = async (v) => {
    cur++
    max = Math.max(max, cur)
    await sleep(5)
    cur--
    if (v === 'bad') throw new Error('boom')
    return v * 2
  }
  const { results, errors } = await mapLimit([1, 2, 'bad', 4, 5, 6, 7, 8, 9, 10], 3, fn)
  eq(max <= 3, true, 'concurrency never exceeds limit (saw ' + max + ')')
  eq(JSON.stringify(results), JSON.stringify([2, 4, undefined, 8, 10, 12, 14, 16, 18, 20]), 'ordered results')
  eq(errors.length, 1, 'one error collected')
  eq(errors[0].index, 2, 'error index')
  eq(errors[0].error.message, 'boom', 'error message')
  const none = await mapLimit([1, 2, 3], 2, async (v) => v)
  eq(none.errors.length, 0, 'no failures case')
  eq(JSON.stringify(none.results), JSON.stringify([1, 2, 3]), 'no failures results')
  console.log('PASS: bounded concurrency with error aggregation')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
