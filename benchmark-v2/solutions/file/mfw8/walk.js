function walkAll(fs, prefix) {
  if (prefix === '') return fs.paths()
  const withSlash = prefix.endsWith('/') ? prefix : prefix + '/'
  return fs.paths().filter((p) => p === prefix || p.startsWith(withSlash))
}
module.exports = { walkAll }
