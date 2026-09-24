// Task: readFileP(path) is the promisified version of readCb below.
// It must resolve with the file contents on success and REJECT with the
// original error (e.g. ENOENT) on failure — never swallow errors.

const fs = require('node:fs')

function readCb(path, cb) {
  fs.readFile(path, (err, data) => cb(err, data))
}

function readFileP(path) {
  // BUGGY: swallows the error and resolves undefined instead of rejecting.
  return new Promise((resolve) => {
    readCb(path, (err, data) => {
      if (err) {
        console.error('read error (ignored):', err.code)
        resolve(undefined)
        return
      }
      resolve(data)
    })
  })
}

module.exports = { readFileP }
