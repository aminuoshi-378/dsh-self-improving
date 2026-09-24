const { parseIni } = require('./bug.cjs')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
const r = parseIni('a=1\n[sec]\nb = true \n; comment\n# hash comment\nc=hello\nd=3.5\nd=over\ne=\n\n[other]\nneg=-7\n')
eqJson(r, {
  global: { a: 1 },
  sections: { sec: { b: true, c: 'hello', d: 'over', e: '' }, other: { neg: -7 } },
}, 'types, comments, last-wins, empty value')
const only = parseIni('[solo]\nx=false\n')
eqJson(only, { global: {}, sections: { solo: { x: false } } }, 'empty global')
const g = parseIni('top=5\n')
eqJson(g, { global: { top: 5 }, sections: {} }, 'global-only doc')
const noisy = parseIni('nosign  \n[weird name]\n  k = v  \n')
eqJson(noisy, { global: {}, sections: { 'weird name': { k: 'v' } } }, 'key without = ignored, header trimmed')
console.log('PASS: INI parsing with typing and comments')
