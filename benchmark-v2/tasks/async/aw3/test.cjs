const { sleep } = require('./bug.cjs')
async function main() {
  const t0 = Date.now()
  const v = await sleep(100, 'ok')
  const elapsed = Date.now() - t0
  if (v !== 'ok') throw new Error(`value must pass through, got ${JSON.stringify(v)}`)
  if (elapsed < 90) throw new Error(`must wait ~100ms, resolved after ${elapsed}ms`)
  await sleep(1)
  console.log('PASS: sleep actually waits')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
