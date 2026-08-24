const { fetchData } = require('./bug.cjs')

async function run() {
  const ok = await fetchData(false)
  if (!ok || ok.status !== 'ok') {
    console.error('FAIL: fetchData(false) should return {status:"ok"}')
    process.exit(1)
  }

  try {
    await fetchData(true)
    console.error('FAIL: fetchData(true) should throw')
    process.exit(1)
  } catch (e) {
    if (e.message !== 'Network error') {
      console.error(`FAIL: wrong error message: ${e.message}`)
      process.exit(1)
    }
  }
  console.log('PASS: fetchData handles success and error correctly')
}
run()
