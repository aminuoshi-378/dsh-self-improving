function withTimeoutResult(promise, ms) {
  return Promise.race([
    promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, reason: error?.message ?? String(error) })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms)),
  ])
}
module.exports = { withTimeoutResult }
