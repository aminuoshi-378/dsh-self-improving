const { sequence } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  const results = await sequence([
    async () => 1,
    async (prev) => { await delay(5); return prev + 1 },
    async (prev) => prev * 2,
  ])
  if (JSON.stringify(results) !== JSON.stringify([1, 2, 4])) throw new Error(`chained results wrong: ${JSON.stringify(results)}`)

  const calls = []
  let caught = null
  try {
    await sequence([
      async () => { calls.push('s1'); return 'a' },
      async () => { calls.push('s2'); throw new Error('stop') },
      async () => { calls.push('s3'); return 'c' },
    ])
  } catch (error) { caught = error }
  if (!caught || caught.message !== 'stop') throw new Error('must reject with the failing step')
  if (calls.length !== 2 || calls[0] !== 's1' || calls[1] !== 's2') throw new Error(`steps after the failure must not run: ${JSON.stringify(calls)}`)
  console.log('PASS: sequence chains, collects, and stops at the first failure')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
