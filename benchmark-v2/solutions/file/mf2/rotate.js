function rotate(fs, base, keep) {
  if (!fs.exists(base)) return
  for (let i = keep; i >= 2; i--) {
    if (fs.exists(`${base}.${i - 1}`)) fs.writeFile(`${base}.${i}`, fs.readFile(`${base}.${i - 1}`))
  }
  fs.writeFile(`${base}.1`, fs.readFile(base))
}
module.exports = { rotate }
