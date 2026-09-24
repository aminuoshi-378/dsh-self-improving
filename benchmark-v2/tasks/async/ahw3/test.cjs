const { createQueue } = require('./bug.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
;(async () => {
  const q = createQueue(2)
  let cur = 0
  let max = 0
  const mk = (v, ms) => async () => {
    cur++
    max = Math.max(max, cur)
    await sleep(ms)
    cur--
    return v
  }
  eq(q.size(), 0, 'empty queue size')
  const ps = [q.push(mk(1, 30)), q.push(mk(2, 10)), q.push(mk(3, 5)), q.push(mk(4, 5))]
  eq(q.size(), 4, 'size counts unsettled')
  const vals = await Promise.all(ps)
  eq(JSON.stringify(vals), JSON.stringify([1, 2, 3, 4]), 'push resolves with task results')
  eq(max <= 2, true, 'concurrency cap respected (saw ' + max + ')')
  await sleep(20)
  eq(q.size(), 0, 'drained size')
  const failed = await q.push(async () => { throw new Error('qerr') }).then(() => 'resolved', (e) => e.message)
  eq(failed, 'qerr', 'task rejection propagates')
  const after = await q.push(async () => 'next-ok')
  eq(after, 'next-ok', 'queue keeps working after a failure')
  console.log('PASS: bounded FIFO queue')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
