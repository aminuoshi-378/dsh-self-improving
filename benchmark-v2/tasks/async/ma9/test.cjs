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
// Interface stability: module surface must stay require-compatible.
{
  const m = require('./breaker')
  const fns = ["CircuitBreaker"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./breaker.js must still export ${fn}`)
    process.exit(1)
  }
}
{
  const m = require('./client')
  const fns = ["callEndpoint"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./client.js must still export ${fn}`)
    process.exit(1)
  }
}
{
  const m = require('./retry')
  const fns = ["retryWithBackoff"]
  for (const fn of fns) if (typeof m[fn] !== 'function') {
    console.error(`FAIL ./retry.js must still export ${fn}`)
    process.exit(1)
  }
}
const { callEndpoint } = require('./client.js')
const { retryWithBackoff } = require('./retry.js')
const { CircuitBreaker } = require('./breaker.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`FAIL ${msg}: got ${a}, want ${e}`); process.exit(1) }
}
;(async () => {
  const seq = [['ok',1],['fail',1],['ok',1],['fail',1],['fail',1]]
  const out = []
  for (const [kind, fails] of seq) {
    try {
      const v = await callEndpoint('svc-a3', async () => {
        if (kind === 'fail') { out.push('F'); throw new Error('endpoint down') }
        out.push('S')
        return 'ok-' + kind
      }, { retries: 1, baseMs: 1, threshold: 1, cooldownMs: 96 })
      out.push('R:' + v)
    } catch (e) {
      out.push(e.message === 'OPEN' ? 'OPEN' : 'ERR:' + e.message)
    }
    await sleep(3)
  }
  eqHash(JSON.stringify(out), '57f09a79c23b9e7c08c9f62a3bf049a7264999013013938d1f34d58c33cca885', 'breaker state machine trace')
  const br = new CircuitBreaker(2, 10)
  eqHash(JSON.stringify(br.state), '02e31f51aa8b1b6a622c4f7c30fab328d711cad4c9da74b9965ada8aa15d9df2', 'starts closed')
  await br.call(async () => { throw new Error('x') }).then(() => 'ok', (e) => e.message)
  await br.call(async () => { throw new Error('x') }).then(() => 'ok', (e) => e.message)
  eqHash(JSON.stringify(br.state), '35ff74aeea25311f4fe759a6b762c8cd41a79adb23dd5615b92cf215175a63e5', 'two consecutive failures open it')
  let opened = null
  try { await br.call(async () => 'v') } catch (e) { opened = e.message }
  eqHash(JSON.stringify(opened), 'be0a10fd97364a8fcdbc5bee5360b8ef41f3693ffcef3804485a3b96c2b2ab65', 'open gate rejects immediately')
  await sleep(12)
  const probe = await br.call(async () => 'recovered')
  eqHash(JSON.stringify(probe), 'e0e8cf3e3d052f7ba8e92e53835ef6b8a22b2e8fe923457a16006b211e9706e2', 'probe after cooldown closes on success')
  eqHash(JSON.stringify(br.state), '02e31f51aa8b1b6a622c4f7c30fab328d711cad4c9da74b9965ada8aa15d9df2', 'closed after probe success')
  const calls = []
  let n = 0
  const v = await retryWithBackoff(() => { calls.push(++n); if (n < 3) throw new Error('t'); return 'w' }, { retries: 4, baseMs: 1 })
  eqHash(JSON.stringify(v), '7265b875feb0d1730ead43d3408195fb5ab0827b46bd185a737c447c51446c3b', 'retry still works standalone')
  eqHash(JSON.stringify(calls.length), '4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce', 'retry call count')
  console.log('PASS: resilience stack end to end')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
