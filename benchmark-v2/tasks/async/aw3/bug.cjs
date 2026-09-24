// Task: sleep(ms, value) resolves with `value` only AFTER at least `ms`
// milliseconds have passed.

function sleep(ms, value) {
  // BUGGY: resolves immediately — no timer at all.
  return Promise.resolve(value)
}

module.exports = { sleep }
