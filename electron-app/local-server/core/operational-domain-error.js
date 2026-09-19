'use strict'
class OperationalError extends Error { constructor(code, message) { super(message); this.code = code } }
module.exports = { OperationalError }
