function memoizeAsync(fn) {
  const cache = new Map()
  return function memoized(arg) {
    if (!cache.has(arg)) {
      const promise = Promise.resolve().then(() => fn(arg))
      cache.set(arg, promise)
      promise.catch(() => cache.delete(arg))
    }
    return cache.get(arg)
  }
}
module.exports = { memoizeAsync }
