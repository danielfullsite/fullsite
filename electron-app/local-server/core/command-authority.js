'use strict'
const { FINANCIAL_COMMANDS } = require('./financial-domain')
// Only this transport boundary constructs context.actor. Auth tokens stay out
// of the command payload and therefore out of durable logs and broadcasts.
async function handleAuthenticatedCommand({ cmdHandler, actorAuthority, msg, clientId, terminalId, actorToken }) {
  let actor
  if (FINANCIAL_COMMANDS.has(msg.payload?.command_type)) {
    if (!actorAuthority) return { error: 'Autorización de empleados no disponible en Caja', code: 'ACTOR_REQUIRED' }
    try { actor = actorAuthority.verify(actorToken, terminalId) }
    catch (error) { return { error: error.message, code: error.code || 'ACTOR_REQUIRED' } }
  }
  return cmdHandler.handle(msg, clientId, { actor })
}
module.exports = { handleAuthenticatedCommand }
