const { parallelMap } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  let running = 0
  let peak = 0
  const results = await parallelMap([0, 1, 2, 3, 4, 5], 2, async (n) => {
    running++; peak = Math.max(peak, running); await delay(5); running--
    if (n === 2) throw new Error('slot fails')
    return n * 10
  })
  if (peak > 2) throw new Error(`concurrency must stay <= 2, saw ${peak}`)
  if (JSON.stringify(results[0]) !== '0' || results[2]?.error !== 'slot fails' || JSON.stringify(results[5]) !== '50') {
    throw new Error(`order and error-slot shape wrong: ${JSON.stringify(results)}`)
  }
  const all = await parallelMap([1, 2], 2, async (n) => n + 1)
  if (JSON.stringify(all) !== JSON.stringify([2, 3])) throw new Error(`all-ok results wrong: ${JSON.stringify(all)}`)
  console.log('PASS: parallelMap bounds concurrency and never rejects')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
