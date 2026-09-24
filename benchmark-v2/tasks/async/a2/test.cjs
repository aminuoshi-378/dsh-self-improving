const { waterfall } = require('./bug.cjs')

async function main() {
  const result = await waterfall([
    async () => 1,
    async (prev) => prev + 1,
    async (prev) => prev * 10,
  ])
  if (result !== 20) throw new Error(`chained result must be 20, got ${result}`)

  const calls = []
  let caught = null
  try {
    await waterfall([
      async () => { calls.push('s1'); return 'a' },
      async (prev) => { calls.push(`s2:${prev}`); if (prev !== 'a') throw new Error('chain broken'); throw new Error('boom') },
      async () => { calls.push('s3'); return 'x' },
    ])
  } catch (error) {
    caught = error
  }
  if (!caught) throw new Error('waterfall must reject on step failure')
  if (caught.message !== 'boom') throw new Error(`must reject with 'boom', got '${caught.message}'`)
  if (calls.length !== 2 || calls[0] !== 's1' || calls[1] !== 's2:a') {
    throw new Error(`steps after the failure must not run; calls=${JSON.stringify(calls)}`)
  }

  console.log('PASS: waterfall chains results and stops at first error')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
