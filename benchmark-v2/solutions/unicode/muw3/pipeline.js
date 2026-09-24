function cleanTokens(str) {
  return require('./tokenize.js').graphemes(require('./normalize.js').normalizeKeepCase(str))
}
function renderTokens(tokens) {
  return tokens.join('')
}
function clean(str) {
  return renderTokens(cleanTokens(str))
}
module.exports = { cleanTokens, renderTokens, clean }
