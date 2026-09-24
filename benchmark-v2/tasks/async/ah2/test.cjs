const { retryWithBackoff } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
;(async () => {
  let calls = 0
  let err = null
  try {
    await retryWithBackoff(() => {
      calls++
      if (calls % 2 === 1) throw new Error('sync' + calls)
      return Promise.reject(new Error('async' + calls))
    }, { retries: 4, baseMs: 1 })
  } catch (e) { err = e }
  eq(calls, 5, 'alternating sync/async failures both retried')
  eq(err && err.message, 'sync5', 'last attempt was the sync throw')

  let slow = 0
  const v = await retryWithBackoff(async () => {
    slow++
    if (slow < 4) return Promise.reject(new Error('not-yet'))
    return { ready: true }
  }, { retries: 9, baseMs: 1 })
  eq(JSON.stringify(v), JSON.stringify({ ready: true }), 'object result passes through')
  eq(slow, 4, 'fourth attempt wins')

  let one = 0
  let oneErr = null
  try { await retryWithBackoff(() => { one++; throw new Error('only') }, { retries: 0, baseMs: 1 }) }
  catch (e) { oneErr = e }
  eq(one, 1, 'zero retries, one call')
  eq(oneErr && oneErr.message, 'only', 'zero-retry error')

  let hit = 0
  const first = await retryWithBackoff(() => { hit++; return 42 }, { retries: 3, baseMs: 1 })
  eq(first, 42, 'immediate success')
  eq(hit, 1, 'no retries after success')
  console.log('PASS: mixed failure modes retried (held-out)')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
