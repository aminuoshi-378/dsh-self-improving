const { withTimeout } = require('./bug.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const value = await withTimeout(Promise.resolve('v'), 50)
  if (value !== 'v') throw new Error(`fast promise must pass through, got ${JSON.stringify(value)}`)

  let caught = null
  try {
    await withTimeout(Promise.reject(new Error('boom')), 50)
  } catch (error) {
    caught = error
  }
  if (!caught || caught.message !== 'boom') throw new Error('rejections must pass through')

  const outcome = await Promise.race([
    withTimeout(new Promise(() => {}), 30).then(
      () => 'resolved',
      (error) => `rejected:${error.message}`,
    ),
    delay(300).then(() => 'HUNG'),
  ])
  if (outcome !== 'rejected:timeout') {
    throw new Error(`never-settling input must reject with 'timeout' quickly, got ${JSON.stringify(outcome)}`)
  }

  console.log('PASS: withTimeout bounds the wait with a timeout rejection')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
