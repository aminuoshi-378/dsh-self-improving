const { withRetry } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  let attempts = 0
  const flaky = async () => { attempts++; await delay(5); if (attempts === 1) throw new Error('flaky'); return 'ok' }
  const v = await withRetry(flaky, { retries: 3, shouldRetry: () => true })
  if (v !== 'ok' || attempts !== 2) throw new Error(`retry-once case wrong: v=${v} attempts=${attempts}`)

  attempts = 0
  let caught = null
  try {
    await withRetry(async () => { attempts++; throw new Error('fatal') }, { retries: 3, shouldRetry: () => false })
  } catch (error) { caught = error }
  if (!caught || caught.message !== 'fatal') throw new Error('non-retryable errors must propagate as-is')
  if (attempts !== 1) throw new Error(`shouldRetry:false means exactly 1 attempt, got ${attempts}`)

  attempts = 0
  try {
    await withRetry(async () => { attempts++; throw new Error('always') }, { retries: 2, shouldRetry: () => true })
    throw new Error('must reject when retries run out')
  } catch (error) {
    if (error.message !== 'always') throw new Error(`the LAST error must propagate, got '${error.message}'`)
  }
  if (attempts !== 3) throw new Error(`retries:2 means 3 total attempts, got ${attempts}`)
  console.log('PASS: withRetry honors shouldRetry and attempt counts')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
