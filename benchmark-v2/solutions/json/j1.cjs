function strictParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    let line = 1
    let col = 1
    const explicit = /line (\d+) column (\d+)/.exec(message)
    if (explicit) {
      line = Number(explicit[1])
      col = Number(explicit[2])
    } else {
      const pos = /position (\d+)/.exec(message)
      if (pos) {
        const index = Number(pos[1])
        line = 1 + (text.slice(0, index).match(/\n/g) || []).length
        const lastNewline = text.lastIndexOf('\n', index - 1)
        col = index - lastNewline
      }
    }
    return { ok: false, line, col }
  }
}
module.exports = { strictParse }
