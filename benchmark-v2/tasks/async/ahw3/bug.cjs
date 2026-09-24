// Task: createQueue(concurrency) returns { push(fn), size() }. push(fn)
// queues a task (fn returns a Promise) and returns a Promise that settles
// with the task's own result or rejection. At most `concurrency` tasks run
// at once; queued tasks start FIFO. size() counts pushed-but-unsettled
// tasks (running + waiting).

function createQueue(concurrency) {
  // BUGGY: runs everything immediately in parallel.
  return {
    push(fn) { return Promise.resolve().then(fn) },
    size() { return 0 },
  }
}

module.exports = { createQueue }
