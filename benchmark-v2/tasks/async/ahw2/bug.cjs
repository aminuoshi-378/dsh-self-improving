// Task: retryWithBackoff(fn, opts = { retries: 3, baseMs: 1 }) returns a
// Promise. fn may THROW synchronously or return a REJECTED promise — both
// count as a failure to retry. The total number of fn calls is at most
// retries + 1. Between attempts it awaits baseMs * 2^(attempt-1) (only the
// call count is graded, not the delay). When an attempt succeeds, resolve
// with its value and stop. When all attempts fail, reject with the LAST
// error.

async function retryWithBackoff(fn, opts = {}) {
  // BUGGY: only catches async rejections; sync throws escape the retry loop.
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 1
  let attempt = 0
  while (true) {
    const started = fn()
    try {
      return await started
    } catch (e) {
      if (attempt >= retries) throw e
      attempt++
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt))
    }
  }
}

module.exports = { retryWithBackoff }
