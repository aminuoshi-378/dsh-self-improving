function once(fn) {
  let cached = null
  return function onceWrapped(...args) {
    if (!cached) cached = Promise.resolve().then(() => fn(...args))
    return cached
  }
}
module.exports = { once }
