const { padStartCodePoints } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(padStartCodePoints('ab', 4, '\u{1F600}'), '\u{1F600}\u{1F600}ab', 'emoji padding counts once each')
eq(padStartCodePoints('abcd', 4, 'x'), 'abcd', 'already long enough')
eq(padStartCodePoints('a', 3, '\u4e2d'), '\u4e2d\u4e2da', 'bmp pad char')
eq(padStartCodePoints('abc', 5, '0'), '00abc', 'ascii pad')
console.log('PASS: padStartCodePoints counts code points')
