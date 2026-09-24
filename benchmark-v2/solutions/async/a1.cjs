const fs = require('node:fs')
function readCb(path, cb) { fs.readFile(path, (err, data) => cb(err, data)) }
function readFileP(path) {
  return new Promise((resolve, reject) => {
    readCb(path, (err, data) => (err ? reject(err) : resolve(data)))
  })
}
module.exports = { readFileP }
