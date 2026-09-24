// Task: timeoutFallback(promise, ms, fallbackValue) resolves with the promise's
// value if it settles within ms, otherwise resolves `fallbackValue` (a timeout
// never rejects); rejections still propagate.

function timeoutFallback(promise, ms, fallbackValue) {
  // BUGGY: no timeout at all — slow inputs hang.
  return promise
}

module.exports = { timeoutFallback }
