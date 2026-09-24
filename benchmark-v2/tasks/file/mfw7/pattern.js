// pattern.js — glob matching against a WHOLE relative path.
// test.cjs is the complete behavioral contract for this workspace.
function matchGlob(pattern, path) {
  // match zero characters, so 'src/*.js' wrongly hits 'src/sub/a.js' and
  // 'a?b' matches 'ab'.
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[?]/g, '.?')).join('.*') + '$')
  return re.test(path)
}
module.exports = { matchGlob }
