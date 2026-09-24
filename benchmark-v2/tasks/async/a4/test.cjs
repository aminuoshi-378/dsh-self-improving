const { partition } = require('./bug.cjs')

async function main() {
  const { fulfilled, rejected } = await partition([
    Promise.resolve(1),
    Promise.reject(new Error('middle')),
    Promise.resolve(3),
    'plain-value',
  ])

  if (JSON.stringify(fulfilled) !== JSON.stringify([1, 3, 'plain-value'])) {
    throw new Error(`fulfilled must keep order [1,3,'plain-value'], got ${JSON.stringify(fulfilled)}`)
  }
  if (rejected.length !== 1 || rejected[0].message !== 'middle') {
    throw new Error(`rejected must capture the one rejection, got ${JSON.stringify(rejected)}`)
  }

  const all = await partition([Promise.resolve('a'), Promise.resolve('b')])
  if (all.rejected.length !== 0 || all.fulfilled.join('') !== 'ab') {
    throw new Error('no-rejection case must put everything into fulfilled')
  }

  console.log('PASS: partition never rejects and splits fulfilled/rejected in order')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
