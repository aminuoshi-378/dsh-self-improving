const { createQueue } = require('./bug.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
;(async () => {
  const q = createQueue(1)
  const order = []
  let cur = 0
  let max = 0
  const mk = (v) => async () => {
    cur++
    max = Math.max(max, cur)
    await sleep(8)
    cur--
    order.push(v)
    return v * 10
  }
  const ps = [q.push(mk(1)), q.push(mk(2)), q.push(mk(3)), q.push(mk(4)), q.push(mk(5))]
  const vals = await Promise.all(ps)
  eq(JSON.stringify(vals), JSON.stringify([10, 20, 30, 40, 50]), 'values map through')
  eq(JSON.stringify(order), JSON.stringify([1, 2, 3, 4, 5]), 'serial queue keeps FIFO order')
  eq(max, 1, 'concurrency of 1 never overlaps')

  const q2 = createQueue(3)
  const mid = []
  const p1 = q2.push(async () => { await sleep(30); return 'a' })
  const p2 = q2.push(async () => { await sleep(5); mid.push(q2.size()); return 'b' })
  await sleep(1)
  eq(q2.size(), 2, 'two in flight')
  const v1 = await p2
  eq(v1, 'b', 'early task resolves early')
  eq(await p1, 'a', 'late task resolves late')
  if (!(mid.length === 1 && mid[0] === 2)) {
    console.error('FAIL size during flight: ' + JSON.stringify(mid))
    process.exit(1)
  }
  await sleep(30)
  eq(q2.size(), 0, 'drained')
  console.log('PASS: serial order and live size (held-out)')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
