const { timeoutFallback } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  const fast = await timeoutFallback(delay(10).then(() => 'v'), 200, 'fb')
  if (fast !== 'v') throw new Error(`fast value must pass through, got ${JSON.stringify(fast)}`)

  const outcome = await Promise.race([
    timeoutFallback(new Promise(() => {}), 30, 'fallback!').then((v) => 'resolved:' + v, (e) => 'rejected:' + e.message),
    delay(300).then(() => 'HUNG'),
  ])
  if (outcome !== 'resolved:fallback!') throw new Error(`timeout must resolve the fallback, got ${JSON.stringify(outcome)}`)

  let caught = null
  try { await timeoutFallback(Promise.reject(new Error('boom')), 100, 'fb') } catch (error) { caught = error }
  if (!caught || caught.message !== 'boom') throw new Error('rejections must still propagate')
  console.log('PASS: timeoutFallback resolves the fallback on timeout')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
