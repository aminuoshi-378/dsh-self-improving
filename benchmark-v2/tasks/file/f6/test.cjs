const { copyIfNewer } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-'))
  const src = path.join(dir, 'src.txt')
  const dst = path.join(dir, 'dst.txt')
  fs.writeFileSync(src, 'v1')

  const first = await copyIfNewer(src, dst)
  if (!first.copied || fs.readFileSync(dst, 'utf8') !== 'v1') throw new Error('missing dst: first copy must happen')

  // Make src OLDER than dst, then ask again: nothing must change.
  const older = new Date(Date.now() - 60_000)
  fs.utimesSync(src, older, older)
  const dstMtime = fs.statSync(dst).mtimeMs
  const second = await copyIfNewer(src, dst)
  if (second.copied) throw new Error('older src must NOT be copied')
  if (fs.statSync(dst).mtimeMs !== dstMtime || fs.readFileSync(dst, 'utf8') !== 'v1') {
    throw new Error('dst must stay untouched when skipping the copy')
  }

  fs.writeFileSync(src, 'v2')
  const third = await copyIfNewer(src, dst)
  if (!third.copied || fs.readFileSync(dst, 'utf8') !== 'v2') throw new Error('newer src must be copied')

  console.log('PASS: copyIfNewer respects mtime and leaves dst untouched')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
