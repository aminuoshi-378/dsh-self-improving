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
module.exports = { parseIni }
