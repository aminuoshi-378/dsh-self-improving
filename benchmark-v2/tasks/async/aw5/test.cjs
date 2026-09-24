const { memoizeAsync } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  let n = 0
  const memo = memoizeAsync(async (x) => { n++; await delay(10); return `${x}-${n}` })
  const a = await memo(1)
  const b = await memo(2)
  if (a !== '1-1' || b !== '2-2') throw new Error(`args must cache separately: ${a}, ${b}`)

  let runs = 0
  const memo2 = memoizeAsync(async (x) => { runs++; await delay(10); return x * 10 })
  const [r1, r2] = await Promise.all([memo2(3), memo2(3)])
  if (runs !== 1) throw new Error(`concurrent same-arg calls must share ONE run, got ${runs}`)
  if (r1 !== 30 || r2 !== 30) throw new Error('both callers get the shared result')

  let attempts = 0
  const memo3 = memoizeAsync(async (x) => { attempts++; await delay(5); if (attempts === 1) throw new Error('first fails'); return 'recovered' })
  await memo3('x').catch(() => {})
  const recovered = await memo3('x')
  if (recovered !== 'recovered') throw new Error('rejections must not be cached')
  console.log('PASS: memoizeAsync keys by argument and never caches rejections')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
