const { firstSuccess } = require('./bug.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const value = await firstSuccess([
    Promise.reject(new Error('fast failure must not win')),
    delay(20).then(() => 'slow-ok'),
  ])
  if (value !== 'slow-ok') throw new Error(`a later success must win, got ${JSON.stringify(value)}`)

  const early = await firstSuccess([Promise.resolve('first'), delay(20).then(() => 'second')])
  if (early !== 'first') throw new Error(`first settled success wins, got ${JSON.stringify(early)}`)

  let caught = null
  try {
    await firstSuccess([Promise.reject(new Error('e1')), Promise.reject(new Error('e2'))])
  } catch (error) {
    caught = error
  }
  if (!Array.isArray(caught) || caught.length !== 2) {
    throw new Error('all-reject case must reject with the array of reasons')
  }

  console.log('PASS: firstSuccess resolves on first success, aggregates all failures')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
