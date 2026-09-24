async function parallelMap(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index], index)
      } catch (error) {
        results[index] = { error: error?.message ?? String(error) }
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}
module.exports = { parallelMap }
