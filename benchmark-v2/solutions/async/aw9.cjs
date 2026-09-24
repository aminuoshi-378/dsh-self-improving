async function forEachSeq(items, fn) {
  let processed = 0
  for (const item of items) {
    await fn(item)
    processed++
  }
  return processed
}
module.exports = { forEachSeq }
