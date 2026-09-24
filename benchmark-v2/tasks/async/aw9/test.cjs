const { forEachSeq } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  const order = []
  const count = await forEachSeq([1, 2, 3], async (n) => { await delay(10 - n); order.push(n) })
  if (count !== 3 || JSON.stringify(order) !== JSON.stringify([1, 2, 3])) {
    throw new Error(`strict order broken: order=${JSON.stringify(order)} count=${count}`)
  }

  const seen = []
  let caught = null
  try {
    await forEachSeq([1, 2, 3], async (n) => { seen.push(n); if (n === 2) throw new Error('halt') })
  } catch (error) { caught = error }
  if (!caught || caught.message !== 'halt') throw new Error('rejection must propagate')
  if (JSON.stringify(seen) !== JSON.stringify([1, 2])) throw new Error(`later items must not run: ${JSON.stringify(seen)}`)
  console.log('PASS: forEachSeq is sequential and stops on failure')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
