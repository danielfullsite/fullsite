'use strict'
const { FINANCIAL_COMMANDS } = require('./financial-domain')
const { OPERATIONAL_COMMANDS } = require('./operational-domain')
// Only this transport boundary constructs context.actor. Auth tokens stay out
// of the command payload and therefore out of durable logs and broadcasts.
async function handleAuthenticatedCommand({ cmdHandler, actorAuthority, msg, clientId, terminalId, actorToken, installationAuthenticated = false }) {
  let actor
  if (cmdHandler.requiresActor?.(msg.payload?.command_type) || FINANCIAL_COMMANDS.has(msg.payload?.command_type) || OPERATIONAL_COMMANDS.has(msg.payload?.command_type)) {
    // Marcar preparación es una facultad de la instalación, no de una persona:
    // cualquier pantalla que demostró conocer la credencial LAN puede ejecutar
    // SOLAMENTE KITCHEN_SET. La llave hoy es compartida por instalación (no por
    // terminal), así que la bitácora tampoco atribuye la acción a una cabecera
    // terminalId que el cliente podría escoger.
    if (msg.payload?.command_type === 'KITCHEN_SET' && installationAuthenticated) {
      actor = { id: 'installation:kitchen', name: 'Instalación de cocina', role: 'installation_kds',
        permissions: ['actualizar_estatus_orden'], expires_at: Date.now() + 60000 }
    } else {
      if (!actorAuthority) return { error: 'Autorización de empleados no disponible en Caja', code: 'ACTOR_REQUIRED' }
      try { actor = actorAuthority.verify(actorToken, terminalId) }
      catch (error) { return { error: error.message, code: error.code || 'ACTOR_REQUIRED' } }
    }
  }
  return cmdHandler.handle(msg, clientId, { actor })
}
module.exports = { handleAuthenticatedCommand }
