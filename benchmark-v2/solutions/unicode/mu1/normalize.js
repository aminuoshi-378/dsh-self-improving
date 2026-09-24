// normalize.js — text canonicalization layer of the cleaning pipeline.
// normalizeKeepCase(str) NFC-normalizes the text and strips the invisible
// format characters U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ) and U+00AD
// (soft hyphen). Case is preserved.
function normalizeKeepCase(str) {
  return str.normalize('NFC').replace(/[\u200B\u200C\u200D\u00AD]/g, '')
}
module.exports = { normalizeKeepCase }
