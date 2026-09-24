// pool.js — bounded-concurrency mapper (verified stable, do not change).
// test.cjs is the complete behavioral contract for this workspace.
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
