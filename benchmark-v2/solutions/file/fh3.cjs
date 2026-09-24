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
  const lines = []
  for (const [k, v] of Object.entries(doc.global ?? {})) lines.push(`${k}=${String(v)}`)
  for (const [name, sec] of Object.entries(doc.sections ?? {})) {
    lines.push(`[${name}]`)
    for (const [k, v] of Object.entries(sec)) lines.push(`${k}=${String(v)}`)
  }
  return lines.join('\n')
}
module.exports = { stringifyIni, parseIni }
