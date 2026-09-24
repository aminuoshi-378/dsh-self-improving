// Task: strictParse(text) parses strict JSON without throwing.
// Success -> { ok: true, value }. Failure -> { ok: false, line, col } where
// line/col are the 1-based location of the syntax error (as reported by the
// engine, e.g. V8's "... at position N (line L column C)").

function strictParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    // BUGGY: reports no location at all.
    return { ok: false, line: 0, col: 0 }
  }
}

module.exports = { strictParse }
