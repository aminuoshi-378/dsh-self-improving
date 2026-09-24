// Task: takeWhileBmp(str) returns the leading run of BMP code points and
// stops at the FIRST non-BMP character (emoji). The result must be a valid
// string (never a lone surrogate half).

function takeWhileBmp(str) {
  // BUGGY: checks UTF-16 units; an emoji's HIGH surrogate is <= 0xFFFF, so
  // the loop swallows a broken surrogate half.
  let out = ''
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0xFFFF) break
    out += str[i]
  }
  return out
}

module.exports = { takeWhileBmp }
