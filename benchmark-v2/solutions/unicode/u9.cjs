function countOccurrences(str, sub) { return sub === '' ? 0 : str.split(sub).length - 1 }
module.exports = { countOccurrences }
