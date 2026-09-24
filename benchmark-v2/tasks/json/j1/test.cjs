const { strictParse } = require('./bug.cjs')

function ok(actual, msg) {
  if (actual !== true) {
    console.error(`FAIL ${msg}`)
    process.exit(1)
  }
}

const good = strictParse('{"a":1}')
ok(good.ok === true && good.value.a === 1, 'valid JSON parses with value')

const bad1 = strictParse('{"a":1,}')
ok(bad1.ok === false, 'trailing comma is invalid')
ok(bad1.line === 1 && bad1.col === 8, `bad1 reports line 1 col 8 (got ${bad1.line},${bad1.col})`)

const bad2 = strictParse('{"b":\n1,,}')
ok(bad2.ok === false, 'double comma is invalid')
ok(bad2.line === 2 && bad2.col === 3, `bad2 reports line 2 col 3 (got ${bad2.line},${bad2.col})`)
console.log('PASS: strictParse reports 1-based error line and column')
