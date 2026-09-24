// Task: stringifyIni(doc) serializes { global: {...}, sections: {...} } back
// to INI text so that parseIni(stringifyIni(doc)) deep-equals doc:
// - global keys come first as plain 'k=v' lines (never under a [global]
//   header; when global has no keys, nothing is emitted for it)
// - then each section: a '[name]' header followed by its 'k=v' lines,
//   sections in the order they appear in the sections object
// - booleans serialize as true/false, numbers in decimal, strings as-is
// - keys/values are written trimmed; no comments or blank lines are emitted
// stringifyIni({ global: { a: 1 }, sections: {} }) -> 'a=1'
// parseIni(stringifyIni(doc)) must round-trip doc exactly.

function parseIni(text) {
  const out = { global: {}, sections: {} }
  let cur = out.global
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue
    const head = /^\[(.+)\]$/.exec(line)
    if (head) { cur = out.sections[head[1].trim()] ??= {}; continue }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const rawVal = line.slice(eq + 1).trim()
    let val = rawVal
    if (rawVal === 'true') val = true
    else if (rawVal === 'false') val = false
    else if (/^-?\d+$/.test(rawVal)) val = Number(rawVal)
    cur[key] = val
  }
  return out
}

function stringifyIni(doc) {
  // BUGGY: wraps global keys under a [global] header and stringifies
  // booleans as 'True'/'False'.
  const lines = []
  lines.push('[global]')
  for (const [k, v] of Object.entries(doc.global)) lines.push(`${k}=${String(v)}`)
  for (const [name, sec] of Object.entries(doc.sections)) {
    lines.push(`[${name}]`)
    for (const [k, v] of Object.entries(sec)) lines.push(`${k}=${String(v)}`)
  }
  return lines.join('\n')
}

module.exports = { stringifyIni, parseIni }
