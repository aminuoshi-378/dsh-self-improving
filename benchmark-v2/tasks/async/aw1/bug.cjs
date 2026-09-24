// Task: withTimeout(promise, ms) settles with the promise's own outcome if it
// settles within ms; otherwise it REJECTS with Error('timeout') within ms.
// The returned promise must never hang.

function withTimeout(promise, ms) {
  // BUGGY: no timeout at all — a never-settling input hangs forever.
  return promise
}

module.exports = { withTimeout }
