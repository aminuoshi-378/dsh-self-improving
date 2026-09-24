const { withTimeoutResult } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  const fast = await withTimeoutResult(delay(10).then(() => 'v'), 200)
  if (fast.ok !== true || fast.value !== 'v') throw new Error(`fast shape wrong: ${JSON.stringify(fast)}`)

  const outcome = await Promise.race([
    withTimeoutResult(new Promise(() => {}), 30),
    delay(300).then(() => 'HUNG'),
  ])
  if (outcome.ok !== false || outcome.reason !== 'timeout') throw new Error(`timeout shape wrong: ${JSON.stringify(outcome)}`)

  const failed = await withTimeoutResult(Promise.reject(new Error('boom')), 100)
  if (failed.ok !== false || failed.reason !== 'boom') throw new Error(`rejection shape wrong: ${JSON.stringify(failed)}`)
  console.log('PASS: withTimeoutResult never rejects')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
