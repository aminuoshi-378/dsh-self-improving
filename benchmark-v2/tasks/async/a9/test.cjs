const { firstTruthy } = require('./bug.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  let calls = 0
  const hit = await firstTruthy([1, 2, 3, 4, 5], async (n) => { calls++; await delay(5); return n === 3 ? 'yes' : null })
  if (hit !== 3) throw new Error(`must resolve the ITEM, got ${JSON.stringify(hit)}`)
  if (calls !== 3) throw new Error(`must stop calling fn after the hit, called ${calls}`)

  const none = await firstTruthy([1, 2], async () => false)
  if (none !== null) throw new Error(`no hit resolves null, got ${JSON.stringify(none)}`)

  calls = 0
  const immediate = await firstTruthy([7, 8], async () => { calls++; return true })
  if (immediate !== 7 || calls !== 1) throw new Error('first hit wins immediately')
  console.log('PASS: firstTruthy returns the item and stops early')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
