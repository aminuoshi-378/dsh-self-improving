const { dirStats } = require('./bug.cjs')
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
function eqJson(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${msg}: got ${a}, want ${e}`)
    process.exit(1)
  }
}
;(async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dstats-'))
  writeFileSync(path.join(root, 'a.txt'), '12345')
  mkdirSync(path.join(root, 'sub'))
  writeFileSync(path.join(root, 'sub', 'b.bin'), Buffer.alloc(10))
  writeFileSync(path.join(root, '.hidden'), 'xy')
  symlinkSync(path.join(root, 'a.txt'), path.join(root, 'link.txt'))
  symlinkSync('/nonexistent-target-xyz', path.join(root, 'broken'))
  symlinkSync(path.join(root, 'sub'), path.join(root, 'dirlink'))
  const st = await dirStats(root)
  eqJson(st, { files: 3, bytes: 17 }, 'files+hidden, symlinks skipped')

  const empty = mkdtempSync(path.join(tmpdir(), 'dstats-empty-'))
  eqJson(await dirStats(empty), { files: 0, bytes: 0 }, 'empty directory')

  const deep = mkdtempSync(path.join(tmpdir(), 'dstats-deep-'))
  mkdirSync(path.join(deep, 'a'))
  mkdirSync(path.join(deep, 'a', 'b'))
  mkdirSync(path.join(deep, 'a', 'b', 'c'))
  writeFileSync(path.join(deep, 'a', 'b', 'c', 'x'), 'abcd')
  writeFileSync(path.join(deep, 'a', 'y'), 'zzz')
  eqJson(await dirStats(deep), { files: 2, bytes: 7 }, 'three levels deep')
  console.log('PASS: recursive stats skip symlinks')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
