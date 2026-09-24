// Task: settleSummary(promise) ALWAYS resolves: fulfilled -> {status:'fulfilled', value};
// rejected -> {status:'rejected', reason}. The underlying error never propagates.

function settleSummary(promise) {
  // BUGGY: rejections propagate.
  return promise.then((value) => ({ status: 'fulfilled', value }))
}

module.exports = { settleSummary }
