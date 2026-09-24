function sleep(ms, value) { return new Promise((resolve) => setTimeout(() => resolve(value), ms)) }
module.exports = { sleep }
