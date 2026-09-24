// Task: sequence(steps) runs promise-returning steps strictly IN ORDER: each
// step receives the previous step's result; ALL results are collected into an
// array (in execution order); a rejection stops the chain immediately and
// propagates (later steps never run).

async function sequence(steps) {
  // BUGGY: fires everything in parallel and collects nothing.
  await Promise.all(steps.map((fn) => fn()))
  return []
}

module.exports = { sequence }
