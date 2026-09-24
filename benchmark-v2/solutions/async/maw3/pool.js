// pool.js — bounded-concurrency mapper (verified stable, do not change).
// mapLimit(items, limit, fn) runs fn(item, index) with at most `limit` calls
// in flight and resolves { results, errors } — results ordered like items
// (failed slots undefined), errors as { index, error }.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  const errors = []
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try { results[i] = await fn(items[i], i) }
      catch (error) { errors.push({ index: i, error }) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, () => worker()))
  return { results, errors }
}
module.exports = { mapLimit }
