// Task: insertAt(str, index, insertion) inserts `insertion` BEFORE the
// index-th CODE POINT of str (index counts code points; index >= length
// appends at the end; the emoji in either string must survive intact).

function insertAt(str, index, insertion) {
  // BUGGY: slices UTF-16 code units, cutting surrogate pairs.
  return str.slice(0, index) + insertion + str.slice(index)
}

module.exports = { insertAt }
