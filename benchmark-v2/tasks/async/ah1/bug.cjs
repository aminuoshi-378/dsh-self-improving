// Task: mapLimit(items, limit, fn) returns a Promise of { results, errors }.
// fn(item, index) returns a Promise. At most `limit` fn calls may be in
// flight at once. All items run; the promise settles only after every task
// settled. results is ordered like the input (a failed slot is undefined).
// errors is a list of { index, error } in completion order.

function mapLimit(items, limit, fn) {
  // BUGGY: unbounded concurrency, first rejection wins, no error report.
  return Promise.all(items.map(fn)).then((results) => ({ results, errors: [] }))
}

module.exports = { mapLimit }
