async function retryUntil(fn, opts) {
  let result
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    result = await fn()
    if (opts.isDone(result)) return result
  }
  return result
}
module.exports = { retryUntil }
