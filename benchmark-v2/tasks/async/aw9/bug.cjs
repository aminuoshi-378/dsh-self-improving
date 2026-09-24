// Task: forEachSeq(items, fn) awaits fn(item) STRICTLY in order; a rejection
// stops the loop (later items never processed); resolves with the number of
// items processed before the loop finished.

async function forEachSeq(items, fn) {
  // BUGGY: fires fn for every item without awaiting — order and failure
  // semantics are gone.
  items.forEach((item) => fn(item))
  return items.length
}

module.exports = { forEachSeq }
