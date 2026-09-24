const { retryWithBackoff } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
;(async () => {
  let calls = 0
  let lastErr = null
  try {
    await retryWithBackoff(async () => { calls++; throw new Error('e' + calls) }, { retries: 3, baseMs: 1 })
  } catch (e) { lastErr = e }
  eq(calls, 4, 'retries+1 async attempts')
  eq(lastErr && lastErr.message, 'e4', 'last error surfaced')

  let calls2 = 0
  const val = await retryWithBackoff(async () => { calls2++; if (calls2 < 3) throw new Error('x'); return 'ok' }, { retries: 5, baseMs: 1 })
  eq(val, 'ok', 'success value resolves')
  eq(calls2, 3, 'stops after success')

  let calls3 = 0
  let syncErr = null
  try {
    await retryWithBackoff(() => { calls3++; throw new Error('sync-boom') }, { retries: 2, baseMs: 1 })
  } catch (e) { syncErr = e }
  eq(calls3, 3, 'sync throws are retried too')
  eq(syncErr && syncErr.message, 'sync-boom', 'sync error surfaced')

  let calls4 = 0
  let zeroErr = null
  try {
    await retryWithBackoff(async () => { calls4++; throw new Error('once') }, { retries: 0 })
  } catch (e) { zeroErr = e }
  eq(calls4, 1, 'retries 0 runs exactly once')
  eq(zeroErr && zeroErr.message, 'once', 'zero-retry error surfaced')

  let doneCalls = 0
  const v = await retryWithBackoff(async () => { doneCalls++; return 7 }, { retries: 5, baseMs: 1 })
  eq(v, 7, 'first-try success value')
  eq(doneCalls, 1, 'no extra calls after success')
  console.log('PASS: retry covers sync and async failures')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
