// Task: firstTruthy(items, fn) runs fn(item) SEQUENTIALLY and resolves with the
// first ITEM whose fn returns truthy; it stops calling fn once found; resolves
// null when nothing qualifies.

async function firstTruthy(items, fn) {
  // BUGGY: fires every fn in parallel and returns the first fn RESULT, not the item.
  const results = await Promise.all(items.map((item) => fn(item)))
  return results.find((r) => r) ?? null
}

module.exports = { firstTruthy }
