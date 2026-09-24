const fs = require('node:fs/promises')
async function appendJsonLine(file, obj) { await fs.appendFile(file, `${JSON.stringify(obj)}\n`) }
module.exports = { appendJsonLine }
