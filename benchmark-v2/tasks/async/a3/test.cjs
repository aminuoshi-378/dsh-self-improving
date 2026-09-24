const { retry } = require('./bug.cjs')

async function main() {
  let attempts = 0
  const flaky = async () => {
    attempts++
    if (attempts < 3) throw new Error('flaky')
    return 'ok'
  }
  const value = await retry(flaky, { retries: 3, baseMs: 1 })
  if (value !== 'ok') throw new Error(`must return 'ok', got ${JSON.stringify(value)}`)
  if (attempts !== 3) throw new Error(`expected 3 attempts, got ${attempts}`)

  attempts = 0
  let caught = null
  try {
    await retry(async () => { attempts++; throw new Error('always') }, { retries: 3, baseMs: 1 })
  } catch (error) {
    caught = error
  }
  if (!caught) throw new Error('retry must reject when every attempt fails')
  if (caught.message !== 'always') throw new Error(`must reject with the last error, got '${caught.message}'`)
  if (attempts !== 4) throw new Error(`retries:3 means 4 total attempts, got ${attempts}`)

  attempts = 0
  try {
    await retry(async () => { attempts++; throw new Error('x') }, { retries: 0, baseMs: 1 })
    throw new Error('must reject even with zero retries')
  } catch (error) {
    if (error.message !== 'x') throw new Error(`expected last error 'x', got '${error.message}'`)
  }
  if (attempts !== 1) throw new Error(`retries:0 means exactly 1 attempt, got ${attempts}`)

  console.log('PASS: retry attempts exactly retries+1 times and rejects the last error')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
