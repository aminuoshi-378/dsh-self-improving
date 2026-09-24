// Task: mapLimit(items, limit, fn) maps fn over items with AT MOST `limit`
// concurrent executions, returning results in ORIGINAL order. fn may reject:
// the whole call rejects with that error.

async function mapLimit(items, limit, fn) {
  // BUGGY: fires every fn at once — no concurrency bound.
  return Promise.all(items.map((item, index) => fn(item, index)))
}

module.exports = { mapLimit }
