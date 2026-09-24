function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms)
    }),
  ])
}
module.exports = { withTimeout }
