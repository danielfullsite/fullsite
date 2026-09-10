'use strict'
// ─── Command Handler ──────────────────────────────────────────────────────────
// Validates incoming WS commands and routes them to the event store.
// Explicit Caja cutover enables catalog-priced operational commands. Legacy
// installations keep observations until their validated cutover is activated.

const { EVENT } = require('../protocol')
const { FinancialDomain, FinancialError, FINANCIAL_COMMANDS } = require('./financial-domain')
const { OperationalDomain, OperationalError, OPERATIONAL_COMMANDS, authorizeOperational } = require('./operational-domain')
const { prepareOrderPrintEffects } = require('./operational-print')

// Map from command_type (from client) → eventType (stored in log)
const COMMAND_TO_EVENT = {
  ORDER_UPSERTED:  EVENT.ORDER_UPSERTED,
  ORDER_SENT:      EVENT.ORDER_SENT,
  ORDER_CLOSED:    EVENT.ORDER_CLOSED,
  ORDER_CANCELLED: EVENT.ORDER_CANCELLED,
  KDS_ITEM_STATUS: EVENT.KDS_ITEM_STATUS,
  MESA_LOCK:       EVENT.MESA_LOCK,
  MESA_UNLOCK:     EVENT.MESA_UNLOCK,
  TURNO_OPENED:    EVENT.TURNO_OPENED,
  TURNO_CLOSED:    EVENT.TURNO_CLOSED,
  PRINT_COMMAND:   EVENT.PRINT_COMMAND,
  ...Object.fromEntries([...FINANCIAL_COMMANDS].map(type => [type, EVENT[type]])),
  ...Object.fromEntries([...OPERATIONAL_COMMANDS].map(type => [type, EVENT[type]])),
}

class CommandHandler {
  /**
   * @param {{ eventStore: import('./event-store').CoreEventStore, state: import('./state').RestaurantState, wsHub: import('./ws-hub').WsHub, printer: import('../adapters/printer'), restaurantId: string }} opts
   */
  constructor({ eventStore, state, wsHub, printer, restaurantId, catalogStore = null, localAuthorityEnabled = false }) {
    this._store         = eventStore
    this._state         = state
    this._hub           = wsHub
    this._printer       = printer
    this._restaurantId  = restaurantId
    this._catalog = catalogStore
    this._localAuthorityEnabled = localAuthorityEnabled === true
    this._commands = Promise.resolve()
  }

  /**
   * Process a command received from a WS client.
   * @param {object} msg   - parsed client WS message
   * @param {string} fromClientId
   * @returns {Promise<{ event?: object, duplicate?: boolean, error?: string }>}
   */
  handle(msg, fromClientId, context = {}) {
    // Serializes read/validate/commit/project, not only append. Two different
    // payment IDs must never both reserve the same available account balance.
    const operation = this._commands.then(() => this._handle(msg, fromClientId, context))
    this._commands = operation.catch(() => {})
    return operation.catch(error => {
      if (error instanceof FinancialError || error instanceof OperationalError || error.code === 'CATALOG_NOT_READY') return { error: error.message, code: error.code }
      throw error
    })
  }

  async _handle(msg, fromClientId, context) {
    const cmdPayload = msg.payload || {}
    const commandType = cmdPayload.command_type

    if (!commandType || !COMMAND_TO_EVENT[commandType]) {
      return { error: `Unknown command_type: ${commandType}` }
    }

    const commandId = cmdPayload.command_id
    if (!commandId) return { error: 'Missing command_id' }

    // Validate restaurant_id
    if (msg.restaurant_id && msg.restaurant_id !== this._restaurantId) {
      return { error: 'restaurant_id mismatch' }
    }

    if (FINANCIAL_COMMANDS.has(commandType)) {
      if (!this._localAuthorityEnabled) throw new FinancialError('LOCAL_AUTHORITY_DISABLED', 'La autoridad de dinero de Caja no está activada en esta instalación')
      this._authorizeFinancial(commandType, cmdPayload, context.actor)
      if (this._state.getOrder?.(cmdPayload.order_id)?.authority !== 'caja') throw new FinancialError('LEGACY_ORDER_REQUIRES_CUTOVER', 'La orden requiere migración a Caja antes de abrir cuentas o registrar dinero')
    }
    if (this._localAuthorityEnabled && commandType === 'PRINT_COMMAND') {
      throw new OperationalError('CONTROLLED_PRINT_REQUIRED', 'La impresión en Caja debe provenir de una operación autorizada; no se aceptan bytes del navegador')
    }
    if (OPERATIONAL_COMMANDS.has(commandType)) {
      if (!this._localAuthorityEnabled) throw new OperationalError('LOCAL_AUTHORITY_DISABLED', 'La autoridad de escritura de Caja no está activada en esta instalación')
      // Recheck authorization even for a duplicate; a receipt is not permission.
      authorizeOperational(context.actor, { ORDER_SAVE: 'pos.orders.write', ORDER_SEND: 'pos.orders.send', ORDER_MOVE: 'pos.orders.move', ORDER_VOID: 'pos.orders.cancel', TURN_OPEN: 'pos.turns.open', TURN_CLOSE: 'pos.turns.close', CASH_MOVEMENT: 'retiros_programados', KITCHEN_SET: 'actualizar_estatus_orden' }[commandType])
    }
    if (this._localAuthorityEnabled && ['ORDER_UPSERTED', 'KDS_ITEM_STATUS'].includes(commandType)) authorizeOperational(context.actor, 'actualizar_estatus_orden')

    if (commandType === 'PRINT_COMMAND' && (!cmdPayload.station || !cmdPayload.data_b64)) {
      return { error: 'PRINT_COMMAND requires station and data_b64' }
    }

    let operationalResult, operationalCatalog
    const prepareOperational = () => {
      if (!operationalResult) {
        this._validateCommandState(commandType, cmdPayload, fromClientId)
        operationalCatalog = ['ORDER_SAVE', 'ORDER_MOVE', 'ORDER_SEND'].includes(commandType) ? this._catalog?.read() : null
        operationalResult = new OperationalDomain().prepare(cmdPayload, { state: this._state, actor: context.actor, catalogEnvelope: operationalCatalog })
      }
      return operationalResult
    }
    const { duplicate, event } = await this._store.processCommand(
      { command_id: commandId, type: commandType, client_id: fromClientId, restaurant_id: this._restaurantId, payload: cmdPayload },
      {
        eventType: COMMAND_TO_EVENT[commandType],
        buildResult: () => {
          this._validateCommandState(commandType, cmdPayload, fromClientId)
          if (OPERATIONAL_COMMANDS.has(commandType)) return prepareOperational()
          if (!FINANCIAL_COMMANDS.has(commandType)) return undefined
          if (!this._state.getFinancialOrders || !this._state.getOrder) throw new FinancialError('FINANCIAL_PROJECTION_UNAVAILABLE', 'Financial projection is not ready')
          const domain = new FinancialDomain()
          domain.hydrate(this._state.getFinancialOrders())
          return domain.prepare(cmdPayload, { order: this._state.getOrder(cmdPayload.order_id), turno: this._state.getTurno(), actor: context.actor })
        },
        buildEffects: commandType === 'PRINT_COMMAND' ? () => {
          if (!this._printer?.prepareJobs) throw new Error('Durable printer adapter unavailable')
          return { print_jobs: this._printer.prepareJobs(
            cmdPayload.station, Buffer.from(cmdPayload.data_b64, 'base64'), cmdPayload.document_type,
            { commandId, reprint: cmdPayload.reprint === true }
          ) }
        } : commandType === 'ORDER_SEND' ? () => prepareOrderPrintEffects(prepareOperational(), commandId, operationalCatalog, this._printer) : undefined,
      }
    )

    // Idempotent materialization runs on retries too: a crash may have committed
    // the event but not yet populated the printer queue. The original routing and
    // bytes, held in event.effects, must survive config changes and restart.
    // Projection belongs to the commit, even if a later queue write fails. A
    // retry must not leave a committed send invisible or advance it twice.
    if (!duplicate) this._state.apply(event)
    await this._recoverEffect(event)
    const receipt = { command_id: event.payload.command_id, event_id: event.id, sequence: event.sequence }
    if (duplicate) return { duplicate: true, receipt, ...(event.result ? { result: event.result } : {}) }

    // Broadcast the new event to all connected clients
    await this._hub.broadcast(event)

    return { event, receipt, ...(event.result ? { result: event.result } : {}) }
  }
  requiresActor(commandType) {
    return FINANCIAL_COMMANDS.has(commandType) || OPERATIONAL_COMMANDS.has(commandType) ||
      this._localAuthorityEnabled && ['ORDER_UPSERTED', 'KDS_ITEM_STATUS'].includes(commandType)
  }
  _authorizeFinancial(type, payload, actor) {
    if (!actor || typeof actor.id !== 'string' || !Array.isArray(actor.permissions) || !Number.isFinite(actor.expires_at) || actor.expires_at <= Date.now()) {
      throw new FinancialError('ACTOR_REQUIRED', 'An authenticated employee session is required for money operations')
    }
    let permission = ['FINANCIAL_OPEN', 'FINANCIAL_SPLIT'].includes(type) ? 'pos.accounts.manage' : 'pos.payments.collect'
    if (type === 'FINANCIAL_PAYMENT_RESULT') {
      const payment = this._state.getFinancialOrder?.(payload.order_id)?.payments.find(p => p.payment_id === payload.payment_id)
      // EL ESTADO QUE SE QUIERE ESCRIBIR MANDA SOBRE EL METODO DEL PAGO.
      //
      // Al reves --que es como estaba-- un intento con tarjeta quedaba atrapado: como el
      // permiso se elegia por `method === 'external'`, RECHAZAR el intento costaba el
      // mismo permiso imposible que aprobarlo, y la reserva no se podia soltar por
      // ningun camino. Mesa ocupada, saldo retenido, turno sin cerrar.
      //
      // Rechazar no crea dinero: dice que NO entro. Bloquearlo solo deja mesas trabadas,
      // asi que cuesta lo mismo que cobrar. 'unknown' si aparta dinero sin confirmar y
      // por eso sigue pidiendo conciliacion.
      if (payload.status === 'rejected') permission = 'pos.payments.collect'
      else if (payload.status === 'unknown') permission = 'pos.payments.reconcile'
      else if (payment?.method === 'external') permission = 'pos.payments.external_result'
      else if (payment?.status === 'unknown') permission = 'pos.payments.reconcile'
      const attributed = payload.evidence?.received_by ?? payload.evidence?.recorded_by
      if (payment?.method === 'cash' && attributed !== actor.id) throw new FinancialError('ACTOR_MISMATCH', 'Payment evidence must identify the authenticated employee')
    }
    if (!actor.permissions.includes(permission)) throw new FinancialError('PERMISSION_DENIED', `Required permission: ${permission}`)
  }

  _validateCommandState(commandType, cmdPayload, fromClientId) {
    const operationalOrder = this._state.getOrder?.(cmdPayload.order_id)
    if (operationalOrder?.authority === 'caja' && ['ORDER_UPSERTED', 'KDS_ITEM_STATUS'].includes(commandType)) {
      throw new OperationalError('KITCHEN_COMMAND_REQUIRED', 'Confirma los productos enviados mediante el comando de cocina autorizado')
    }
    const financial = this._state.getFinancialOrder?.(cmdPayload.order_id) ||
      this._state.getFinancialOrder?.(cmdPayload.mesa != null ? this._state.getMesa(cmdPayload.mesa)?.order_id : null)
    if (financial && commandType === 'ORDER_CLOSED') {
      throw new FinancialError('FINANCIAL_CLOSE_REQUIRED', 'Use durable payment results; ORDER_CLOSED cannot settle accounts or clear kitchen work')
    }
    // Once accounts exist, a legacy full-order patch must not change any
    // financial inputs or identity. Kitchen can still advance preparation.
    const preparationOnly = Object.keys(cmdPayload).every(key =>
      ['command_id', 'command_type', 'restaurant_id', 'location_id', 'client_id', 'order_id', 'mesa', 'status'].includes(key)) &&
      (cmdPayload.mesa === undefined || cmdPayload.mesa === this._state.getOrder?.(cmdPayload.order_id)?.mesa) &&
      ['enviada', 'preparando', 'lista', 'entregada'].includes(cmdPayload.status)
    if ((this._localAuthorityEnabled || operationalOrder?.authority === 'caja') &&
      (['ORDER_SENT', 'ORDER_CANCELLED', 'ORDER_CLOSED', 'TURNO_OPENED', 'TURNO_CLOSED'].includes(commandType) ||
        commandType === 'ORDER_UPSERTED' && !preparationOnly)) {
      throw new OperationalError('AUTHORITATIVE_COMMAND_REQUIRED', 'Usa los comandos autorizados de Caja; la observación legacy no puede modificar esta cuenta')
    }
    if (financial && (commandType === 'ORDER_CANCELLED' || commandType === 'ORDER_SENT' ||
      commandType === 'ORDER_UPSERTED' && !preparationOnly)) {
      throw new FinancialError('FINANCIAL_ORDER_LOCKED', 'Accounts are already defined; finish or reconcile payments before changing the order')
    }
    if ((commandType === 'TURNO_CLOSED' || commandType === 'TURNO_OPENED' && cmdPayload.turno_id !== this._state.getTurno()?.id) &&
      this._state.getFinancialOrders?.().some(order => order.balance_cents > 0 || order.reserved_cents > 0)) {
      throw new FinancialError('UNSETTLED_FINANCIAL_ACCOUNTS', 'Unpaid accounts or unresolved payment attempts remain in this shift')
    }

    // MESA_LOCK: check for conflicting lock from a different terminal
    if (commandType === 'MESA_LOCK') {
      const { mesa } = cmdPayload
      const existingLock = this._state.getLock(mesa)
      if (existingLock && existingLock.client_id !== fromClientId && existingLock.expires_ms > Date.now()) {
        throw new FinancialError('MESA_LOCK_CONFLICT', `Mesa ${mesa} locked by another terminal`)
      }
    }

  }

  async _recoverEffect(event) {
    if (!event?.effects?.print_jobs?.length) return
    if (!this._printer?.enqueuePreparedJobs) throw new Error('Durable printer adapter unavailable')
    await this._printer.enqueuePreparedJobs(event.effects.print_jobs)
  }

  // Call at startup after event-store replay, before accepting new commands.
  // Legacy PRINT_COMMAND events without intents are not replayed: they may already
  // have printed and cannot be deduplicated safely.
  async recoverPendingEffects() {
    let recovered = 0
    for (const event of await this._store.readAfter(0)) {
      if (!event.effects?.print_jobs) continue
      await this._recoverEffect(event)
      recovered++
    }
    return { recovered }
  }

}

module.exports = { CommandHandler }
