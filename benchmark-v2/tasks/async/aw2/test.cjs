const { mapLimit } = require('./bug.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const doubled = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    await delay(5)
    return n * 2
  })
  if (JSON.stringify(doubled) !== JSON.stringify([2, 4, 6, 8, 10, 12])) {
    throw new Error(`results must keep original order, got ${JSON.stringify(doubled)}`)
  }

  let running = 0
  let peak = 0
  let calls = 0
  await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
    calls++
    running++
    peak = Math.max(peak, running)
    await delay(5)
    running--
  })
  if (calls !== 6) throw new Error(`every item must be processed, got ${calls} calls`)
  if (peak > 2) throw new Error(`concurrency must never exceed limit=2, saw peak ${peak}`)

  let caught = null
  try {
    await mapLimit([1, 2, 3], 2, async (n) => {
      await delay(5)
      if (n === 2) throw new Error('nope')
    })
  } catch (error) {
    caught = error
  }
  if (!caught || caught.message !== 'nope') throw new Error('errors must propagate')

  console.log('PASS: mapLimit bounds concurrency and keeps order')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
