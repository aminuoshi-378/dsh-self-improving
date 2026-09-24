// Task: once(fn) wraps an (async) fn so it executes AT MOST ONCE — even for
// CONCURRENT calls (they all await the same single execution's result).

function once(fn) {
  let result
  // BUGGY: the guard is only set AFTER the await, so concurrent calls all
  // pass the check and fn runs multiple times.
  return async function onceWrapped(...args) {
    if (result) return result
    result = await fn(...args)
    return result
  }
}

module.exports = { once }
