const { deepClone } = require('./bug.cjs')

function ok(cond, msg) {
  if (cond !== true) {
    console.error(`FAIL ${msg}`)
    process.exit(1)
  }
}

const src = { a: { b: 1 }, list: [1, { c: 2 }], s: 'text', n: 7 }
const clone = deepClone(src)

clone.a.b = 99
clone.list[1].c = 88
clone.s = 'changed'

ok(src.a.b === 1, 'nested object stays independent')
ok(src.list[1].c === 2, 'nested array item stays independent')
ok(src.s === 'text', 'top-level primitive stays independent')
ok(clone.a.b === 99 && clone.list[1].c === 88, 'clone keeps the edits')
ok(deepClone(5) === 5, 'primitive passthrough')
ok(JSON.stringify(deepClone(null)) === 'null', 'null passthrough')
console.log('PASS: deepClone isolates every level')
