// Task: padStartCodePoints(str, n, ch): when str has fewer than n CODE POINTS,
// prepend ch (itself possibly an emoji) until the count reaches n; strings
// already at n or more pass through unchanged.

function padStartCodePoints(str, n, ch) {
  // BUGGY: measures UTF-16 length, so an emoji pad character overshoots.
  while (str.length < n) str = ch + str
  return str
}

module.exports = { padStartCodePoints }
