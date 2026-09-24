function matchGlob(pattern, path) {
  function match(p, s) {
    if (p === '') return s === ''
    if (p[0] === '*') {
      for (let i = 0; i <= s.length; i++) {
        if (i > 0 && s[i - 1] === '/') break
        if (match(p.slice(1), s.slice(i))) return true
      }
      return false
    }
    if (s === '') return false
    if (p[0] === '?') {
      if (s[0] === '/') return false
      return match(p.slice(1), s.slice(1))
    }
    if (p[0] !== s[0]) return false
    return match(p.slice(1), s.slice(1))
  }
  return match(pattern, path)
}
module.exports = { matchGlob }
