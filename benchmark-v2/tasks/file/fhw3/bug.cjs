// Task: parseIni(text) parses an INI document into
// { global: { key: value }, sections: { name: { key: value } } }:
// - Lines before any [section] header land in global.
// - A [name] header starts a section; keys after it belong to it.
// - key=value: both sides are trimmed; a key with no '=' is ignored.
// - Blank lines and lines starting with ';' or '#' are comments.
// - Value typing: 'true' -> true, 'false' -> false, pure integer strings
//   (optionally signed) -> number, everything else stays a string.
// - A repeated key keeps the LAST value.
// parseIni('a=1\n[s]\nb = true\n') -> { global: { a: 1 }, sections: { s: { b: true } } }

function parseIni(text) {
  // BUGGY: no trimming, no comment skip, no type inference.
  const out = { global: {}, sections: {} }
  let cur = out.global
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) { cur = {}; out.sections[line.slice(1, -1)] = cur; continue }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    cur[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return out
}

module.exports = { parseIni }
