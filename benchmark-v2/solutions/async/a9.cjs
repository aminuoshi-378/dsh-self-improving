async function firstTruthy(items, fn) {
  for (const item of items) {
    if (await fn(item)) return item
  }
  return null
}
module.exports = { firstTruthy }
