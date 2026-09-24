// Task: withTimeoutResult(promise, ms) NEVER rejects: it resolves
// { ok: true, value } when the promise settles in time, and
// { ok: false, reason } for a timeout ('timeout') or the underlying error message.

function withTimeoutResult(promise, ms) {
  // BUGGY: raw passthrough — rejections propagate and slow inputs hang.
  return promise.then((value) => ({ ok: true, value }))
}

module.exports = { withTimeoutResult }
