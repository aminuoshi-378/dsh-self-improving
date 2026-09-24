function isNonBmpAt(str, i) { const c = Array.from(str)[i]; return c !== undefined && c.codePointAt(0) >= 0x10000 }
module.exports = { isNonBmpAt }
