// normalize.js — text canonicalization layer of the cleaning pipeline.
// test.cjs is the complete behavioral contract for this workspace.
function normalizeKeepCase(str) {
  return str.normalize('NFC').replace(/[\u200B\u200C\u200D\u00AD]/g, '')
}
module.exports = { normalizeKeepCase }
