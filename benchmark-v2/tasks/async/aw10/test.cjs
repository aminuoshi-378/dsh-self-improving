const { allCounted } = require('./bug.cjs')
async function main() {
  const mixed = await allCounted([Promise.resolve(1), Promise.resolve(2), Promise.reject(new Error('x'))])
  if (mixed.fulfilled !== 2 || mixed.rejected !== 1) throw new Error(`mixed counts wrong: ${JSON.stringify(mixed)}`)
  const all = await allCounted([Promise.resolve('a'), Promise.resolve('b')])
  if (all.fulfilled !== 2 || all.rejected !== 0) throw new Error(`all-fulfilled counts wrong: ${JSON.stringify(all)}`)
  const none = await allCounted([])
  if (none.fulfilled !== 0 || none.rejected !== 0) throw new Error('empty input counts zero')
  console.log('PASS: allCounted never rejects and counts both sides')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
