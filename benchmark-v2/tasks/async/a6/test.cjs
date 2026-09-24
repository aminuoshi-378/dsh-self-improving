const { once } = require('./bug.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  let executions = 0
  const work = once(async () => {
    executions++
    await delay(20)
    return 'value'
  })

  const [r1, r2, r3] = await Promise.all([work(), work(), work()])
  if (executions !== 1) throw new Error(`concurrent calls must share ONE execution, got ${executions}`)
  if (r1 !== 'value' || r2 !== 'value' || r3 !== 'value') throw new Error('all callers get the single result')

  const later = await work()
  if (later !== 'value' || executions !== 1) {
    throw new Error(`sequential re-calls must reuse the cached execution, executions=${executions}`)
  }

  console.log('PASS: once dedups concurrent and sequential calls')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
