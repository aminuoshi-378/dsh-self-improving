// Task: countOccurrences(str, sub) counts NON-OVERLAPPING occurrences of sub
// (sub may be an emoji or any code point sequence).

function countOccurrences(str, sub) {
  // BUGGY: String.replace replaces only the FIRST occurrence, so any count
  // above 1 is underreported.
  return (str.length - str.replace(sub, '').length) / sub.length
}

module.exports = { countOccurrences }
