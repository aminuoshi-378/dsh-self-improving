// Task: sameVisual(a, b) reports whether two strings are visually equal:
// NFC-normalize both, then drop the invisible format characters U+200B (ZWSP),
// U+200C (ZWNJ), U+200D (ZWJ) and U+00AD (soft hyphen), then compare.
// Comparison is CASE-SENSITIVE.
// sameVisual('\u00e9', 'e\u0301') -> true   (one NFC normalization plane)
// sameVisual('a\u200Cb', 'ab') -> true      (zero-width space is invisible)
// sameVisual('A', 'a') -> false            (case matters)

function sameVisual(a, b) {
  // BUGGY: raw comparison — decomposition variants and invisible
  // characters make visually identical strings unequal.
  return a === b
}

module.exports = { sameVisual }
