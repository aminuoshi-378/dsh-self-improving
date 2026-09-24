// pipeline.js — end-to-end cleaning pipeline.
// test.cjs is the complete behavioral contract for this workspace.
function cleanTokens(str) {
  // token list, and decomposed accents stay split.
  return require('./tokenize.js').graphemes(str)
}
function renderTokens(tokens) {
  return tokens.join('')
}
function clean(str) {
  return renderTokens(cleanTokens(str))
}
module.exports = { cleanTokens, renderTokens, clean }
