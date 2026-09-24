const { retryUntil } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  let attempts = 0
  const result = await retryUntil(
    async () => { attempts++; await delay(5); return attempts === 1 ? 'raw' : 'done' },
    { maxAttempts: 3, isDone: (r) => r === 'done' },
  )
  if (result !== 'done' || attempts !== 2) throw new Error(`must retry until isDone, got '${result}' after ${attempts}`)

  attempts = 0
  const first = await retryUntil(async () => { attempts++; return 'done' }, { maxAttempts: 3, isDone: (r) => r === 'done' })
  if (first !== 'done' || attempts !== 1) throw new Error('qualifying first result stops immediately')

  attempts = 0
  const exhausted = await retryUntil(async () => { attempts++; return `r${attempts}` }, { maxAttempts: 3, isDone: () => false })
  if (exhausted !== 'r3' || attempts !== 3) throw new Error(`exhaustion must return the LAST result, got '${exhausted}' after ${attempts}`)
  console.log('PASS: retryUntil retries until the predicate or attempts run out')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
