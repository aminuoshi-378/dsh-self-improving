const { settleSummary } = require('./bug.cjs')
async function main() {
  const ok = await settleSummary(Promise.resolve('x'))
  if (ok.status !== 'fulfilled' || ok.value !== 'x') throw new Error(`fulfilled shape wrong: ${JSON.stringify(ok)}`)
  const bad = await settleSummary(Promise.reject(new Error('boom')))
  if (bad.status !== 'rejected' || bad.reason?.message !== 'boom') throw new Error(`rejected shape wrong: ${JSON.stringify(bad)}`)
  console.log('PASS: settleSummary never rejects')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
