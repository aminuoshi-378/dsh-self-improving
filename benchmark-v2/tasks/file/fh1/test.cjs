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
  const root = mkdtempSync(path.join(tmpdir(), 'fh1-'))
  mkdirSync(path.join(root, 'logs'))
  mkdirSync(path.join(root, 'logs', 'old'))
  writeFileSync(path.join(root, 'logs', 'old', '1.log'), 'aaa')       // 3
  writeFileSync(path.join(root, 'logs', '2.log'), 'bbbbb')            // 5
  writeFileSync(path.join(root, '.env'), 'secret=1')                  // 9
  mkdirSync(path.join(root, 'data'))
  symlinkSync(path.join(root, 'logs'), path.join(root, 'data', 'all-logs'))
  symlinkSync(path.join(root, '.env'), path.join(root, 'logs', 'env-link'))
  symlinkSync('/definitely-missing-abc', path.join(root, 'dead'))
  const st = await dirStats(root)
  eqJson(st, { files: 3, bytes: 16 }, 'nested files, dir-link and file-link skipped')

  const flat = mkdtempSync(path.join(tmpdir(), 'fh1-flat-'))
  for (let i = 0; i < 5; i++) writeFileSync(path.join(flat, 'f' + i), '0123456789')
  eqJson(await dirStats(flat), { files: 5, bytes: 50 }, 'flat files')

  const linked = mkdtempSync(path.join(tmpdir(), 'fh1-link-'))
  const target = mkdtempSync(path.join(tmpdir(), 'fh1-target-'))
  writeFileSync(path.join(target, 'big'), 'x'.repeat(100))
  symlinkSync(target, path.join(linked, 'whole-dir'))
  eqJson(await dirStats(linked), { files: 0, bytes: 0 }, 'a directory of only links counts nothing')
  console.log('PASS: symlink immunity at depth (held-out)')
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1) })
