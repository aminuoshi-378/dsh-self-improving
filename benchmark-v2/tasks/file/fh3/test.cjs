const { stringifyIni, parseIni } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
const doc = { global: { host: 'localhost', port: 8080, debug: false, retries: 3 }, sections: { db: { url: 'pg://x', pool: 5, cache: true } } }
const text = stringifyIni(doc)
if (text.includes('[global]')) {
  console.error('FAIL global must not emit a [global] header: ' + JSON.stringify(text))
  process.exit(1)
}
if (!text.includes('[db]') || !text.includes('port=8080') || !text.includes('debug=false') || !text.includes('cache=true')) {
  console.error('FAIL serialization body: ' + JSON.stringify(text))
  process.exit(1)
}
eqJson(parseIni(text), doc, 'round-trip equals the original')
const header = text.split('\n')[0]
if (header.startsWith('[')) {
  console.error('FAIL first line should be a global key, not a header: ' + JSON.stringify(header))
  process.exit(1)
}
const noGlobal = stringifyIni({ global: {}, sections: { only: { k: 1 } } })
eqJson(parseIni(noGlobal), { global: {}, sections: { only: { k: 1 } } }, 'empty global round-trip')
if (!noGlobal.startsWith('[only]')) {
  console.error('FAIL empty global emits nothing before first header: ' + JSON.stringify(noGlobal))
  process.exit(1)
}
const empty = stringifyIni({ global: {}, sections: {} })
eqJson(parseIni(empty), { global: {}, sections: {} }, 'empty doc round-trip')
const multi = stringifyIni({ global: { z: 1 }, sections: { b: { x: 2 }, a: { y: 3 } } })
const firstSection = multi.split('\n').find((l) => l.startsWith('['))
if (firstSection !== '[b]') {
  console.error('FAIL section order preserved: ' + JSON.stringify(multi))
  process.exit(1)
}
eqJson(parseIni(multi), { global: { z: 1 }, sections: { b: { x: 2 }, a: { y: 3 } } }, 'multi-section round-trip')
console.log('PASS: INI serialization round-trip (held-out)')
