const fs = require('node:fs/promises')
async function touchMtime(file, epochMs) {
  const atime = (await fs.stat(file)).atime
  await fs.utimes(file, atime, new Date(epochMs))
  return { touched: true }
}
module.exports = { touchMtime }
