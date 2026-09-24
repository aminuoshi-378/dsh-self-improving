function codePointValues(str) { return Array.from(str).map((c) => c.codePointAt(0)) }
module.exports = { codePointValues }
