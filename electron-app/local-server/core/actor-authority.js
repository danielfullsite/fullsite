'use strict'
// Caja validates PINs against the configured HTTPS authority, then keeps a
// bounded verifier for prepared users/devices. Browser staff/role caches never
// authorize commands. Tokens are not written to the event log or snapshots.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { replaceFile } = require('../adapters/storage/durable-file')
const permissionContract = require('./permission-profiles.json')

const LEVEL = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }
const normalizedRole = role => permissionContract.aliases[role] || role
const fail = (message, status = 401, code = 'ACTOR_REQUIRED') => Object.assign(new Error(message), { status, code })
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y) }
// El presupuesto de intentos es POR TERMINAL. Cuando era uno solo para toda la
// instalación, diez errores en la Entrada dejaban sin poder entrar a la Caja y al
// Escondite: las tres terminales autorizan contra esta misma clase. Un empleado
// que teclea su PIN correcto en una terminal donde nunca se preparó también
// gastaba de ese presupuesto común.
// El tope de instalación se conserva más alto porque la cabecera que identifica
// la terminal la declara el propio cliente: sin él, rotarla daría intentos sin fin.
const VENTANA_INTENTOS_MS      = 10 * 60000
const INTENTOS_POR_TERMINAL    = 10
const INTENTOS_POR_INSTALACION = 30
function permissionsFor(role) {
  const profile = permissionContract.profiles[normalizedRole(role)]
  if (!profile) return []
  const permissions = Object.keys(profile).filter(key => profile[key] === true)
  const mapped = {
    'pos.orders.write': profile.abrir_cuentas_restaurante || profile.abrir_cuentas_llevar,
    'pos.orders.send': profile.registro_comanda,
    'pos.orders.move': profile.cambio_mesa,
    'pos.orders.cancel': profile.cancelar_ordenes,
    'pos.orders.discount': profile.descuentos_ordenes_monto,
    'pos.accounts.manage': profile.abrir_cuentas_restaurante || profile.cerrar_cuentas,
    'pos.payments.collect': profile.cerrar_cuentas,
    // Nadie tenia `external_result`, ni el dueno. El diseno lo reservaba "al adaptador"
    // --una integracion que confirma sola-- pero el adaptador no existe (OP-38) y en
    // AMALAY la terminal bancaria se opera A MANO: el cajero pasa la tarjeta y teclea el
    // numero de autorizacion. Sin este mapeo, ese cobro no se podia cerrar ni cancelar.
    //
    // Va a `cerrar_cuentas` --lo mismo que el efectivo-- y no a gerente, porque el
    // efectivo ya funciona asi: el cajero afirma que recibio $500 sin comprobante alguno.
    // Un voucher de tarjeta deja MAS rastro, no menos: queda en el banco y se concilia
    // despues. Pedir gerente por cada tarjeta, en un restaurante que cobra tarjeta todo
    // el dia, termina en el PIN del gerente compartido con la caja --que es justo el
    // control que se queria proteger.
    'pos.payments.external_result': profile.cerrar_cuentas,
    'pos.payments.reconcile': profile.gerente,
    'pos.turns.open': profile.abrir_dia_operaciones,
    'pos.turns.close': profile.corte_z,
  }
  return [...permissions, ...Object.keys(mapped).filter(key => mapped[key] === true)]
}

class ActorAuthority {
  constructor({ directory, restaurantId, branchId, cloudOrigin = 'https://app.fullsite.mx', fetchImpl = fetch, now = Date.now, credentialTtlMs = 7 * 86400000, cloudTimeoutMs = 5000 }) {
    this.restaurantId = restaurantId; this.branchId = branchId || null; this.now = now; this.fetch = fetchImpl
    const origin = new URL(cloudOrigin)
    if (origin.protocol !== 'https:') throw new Error('La autoridad de PIN requiere HTTPS')
    this.cloudOrigin = origin.origin
    if (!Number.isSafeInteger(credentialTtlMs) || credentialTtlMs <= 0 || credentialTtlMs > 7 * 86400000) throw new Error('Vigencia de credenciales inválida')
    this.ttl = credentialTtlMs
    // La ruta de PIN en la nube encadena varias consultas y puede arrancar en
    // frío. Con 1.8 s, una conexión lenta se declaraba caída y a un empleado sin
    // preparar en esa terminal se le pedía "valida PIN con internet" teniendo
    // internet. El plazo lo acota el reenvío de las terminales secundarias.
    if (!Number.isSafeInteger(cloudTimeoutMs) || cloudTimeoutMs <= 0 || cloudTimeoutMs > 15000) throw new Error('Plazo de la autoridad inválido')
    this.cloudTimeoutMs = cloudTimeoutMs
    fs.mkdirSync(directory, { recursive: true })
    const keyPath = path.join(directory, 'actor-signing-key')
    if (!fs.existsSync(keyPath)) replaceFile(keyPath, crypto.randomBytes(32).toString('hex'))
    this.key = fs.readFileSync(keyPath, 'utf8').trim()
    if (!/^[a-f0-9]{64}$/.test(this.key)) throw new Error('Clave de autoridad inválida')
    this.file = path.join(directory, 'actor-credentials.json')
    this.data = { credentials: {}, failures: {}, denied_devices: {}, last_seen: 0 }
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      // Formato anterior: una lista plana sin terminal. No se puede repartir
      // entre terminales, así que se descarta. Son marcas de diez minutos como
      // mucho, y sólo ocurre una vez, al actualizar.
      if (Array.isArray(this.data.failures)) this.data.failures = {}
      if (this.data.restaurant_id !== restaurantId || this.data.location_id !== this.branchId ||
        !this.data.credentials || !this.data.failures || typeof this.data.failures !== 'object' ||
        !this.data.denied_devices || !Number.isFinite(this.data.last_seen)) {
        throw new Error('Credenciales dañadas o pertenecientes a otra instalación')
      }
    }
    this._queue = Promise.resolve()
    this._faulted = false
  }
  _persist() {
    this.data.restaurant_id = this.restaurantId; this.data.location_id = this.branchId
    this.data.last_seen = Math.max(this.data.last_seen || 0, this.now())
    try { replaceFile(this.file, JSON.stringify(this.data)) }
    catch (error) { this._faulted = true; throw fail('No se pudo guardar la autorización en Caja', 503, 'ACTOR_STORAGE_UNAVAILABLE') }
  }
  // ── Presupuesto de intentos ────────────────────────────────────────────────
  /** Intentos vivos de una terminal, podando de paso los que ya vencieron. */
  _fallosDe(deviceId, now) {
    const vivos = (this.data.failures[deviceId] || []).filter(at => at > now - VENTANA_INTENTOS_MS)
    if (vivos.length) this.data.failures[deviceId] = vivos
    else delete this.data.failures[deviceId]
    return vivos
  }
  /** Poda todas las terminales y devuelve el total vivo de la instalación. */
  _fallosDeLaInstalacion(now) {
    let total = 0
    for (const deviceId of Object.keys(this.data.failures)) total += this._fallosDe(deviceId, now).length
    return total
  }
  _anotarFallo(deviceId, now) {
    if (!Array.isArray(this.data.failures[deviceId])) this.data.failures[deviceId] = []
    this.data.failures[deviceId].push(now)
  }
  _time() {
    if (this._faulted) throw fail('Reinicia y verifica el almacenamiento de Caja antes de autorizar', 503, 'ACTOR_STORAGE_UNAVAILABLE')
    const now = this.now()
    if (!Number.isFinite(now) || now + 60000 < this.data.last_seen) throw fail('Reloj de Caja retrocedió; verificar hora antes de autorizar', 503, 'ACTOR_CLOCK_INVALID')
    return now
  }
  _index(pin) { return crypto.createHmac('sha256', this.key).update('pin:' + pin).digest('hex') }
  _sign(payload) { return crypto.createHmac('sha256', this.key).update(payload).digest('base64url') }
  status() {
    const now = this._time()
    const credentials = Object.values(this.data.credentials).filter(c => c.expires_at > now)
    return { prepared_users: credentials.length, roles: [...new Set(credentials.map(c => c.staff.role))],
      expires_at: credentials.length ? Math.min(...credentials.map(c => c.expires_at)) : null,
      ready: credentials.length > 0, max_validity_ms: this.ttl,
      policy: 'Cada usuario y terminal deben validar PIN con internet antes del corte WAN' }
  }
  login(input) {
    // Includes throttle, network validation and durable write. Concurrent PINs
    // cannot all observe the same attempt budget or overwrite revocations.
    const result = this._queue.then(() => this._login(input))
    this._queue = result.catch(() => {})
    return result
  }
  async _login({ pin, deviceId, restaurantId, minRole }) {
    const now = this._time()
    if (restaurantId !== this.restaurantId || !/^[\w-]{1,64}$/.test(deviceId || '')) throw fail('Scope de acceso inválido', 403, 'ACTOR_SCOPE_INVALID')
    if (!/^\d{4,10}$/.test(pin || '')) throw fail('PIN inválido', 400, 'INVALID_PIN')
    if (minRole && !LEVEL[normalizedRole(minRole)]) throw fail('Permiso solicitado inválido', 400, 'INVALID_ROLE')
    const vivosEnLaInstalacion = this._fallosDeLaInstalacion(now)
    if (this._fallosDe(deviceId, now).length >= INTENTOS_POR_TERMINAL) {
      throw fail('Demasiados intentos en esta terminal; espera diez minutos', 429, 'PIN_RATE_LIMITED')
    }
    if (vivosEnLaInstalacion >= INTENTOS_POR_INSTALACION) {
      throw fail('Demasiados intentos en el restaurante; espera diez minutos', 429, 'PIN_RATE_LIMITED')
    }
    const index = this._index(pin)
    let credential = this.data.credentials[index], offline = false, shiftToken
    try {
      const response = await this.fetch(this.cloudOrigin + '/api/pos/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ pin, client_id: this.restaurantId, device_id: deviceId }),
        signal: AbortSignal.timeout(this.cloudTimeoutMs),
      })
      // Un 429 NO es un veredicto sobre este PIN: la nube limita por IP pública,
      // que en un restaurante comparten las tres terminales y cualquier navegador.
      // Tratarlo como rechazo le decía "PIN rechazado" a quien tecleó el correcto,
      // y encima era peor que estar sin internet, porque con la nube caída ese
      // mismo empleado sí entraba con su credencial preparada. Cae abajo, al
      // camino sin nube, junto con el resto de las respuestas no útiles.
      if ([400, 401, 403].includes(response.status)) {
        const rejection = await response.json().catch(() => ({}))
        if (rejection.code === 'terminal_not_enrolled') this.data.denied_devices[deviceId] = true
        // A device rejection is not an employee revocation. A firm
        // invalid PIN does revoke its cached verifier and every issued session.
        else if (response.status === 401) delete this.data.credentials[index]
        throw fail(rejection.code === 'terminal_not_enrolled' ? 'Terminal no autorizada' : 'PIN rechazado por la autoridad', response.status, rejection.code || 'PIN_REJECTED')
      }
      if (!response.ok) throw new Error('Autoridad no disponible')
      const data = await response.json()
      const staff = data.staff
      if (typeof staff?.id !== 'string' || !staff.id || typeof staff.name !== 'string' || !LEVEL[normalizedRole(staff.role)]) throw fail('Respuesta de autoridad inválida', 502, 'AUTHORITY_RESPONSE_INVALID')
      shiftToken = typeof data.shiftToken === 'string' ? data.shiftToken : undefined
      const unchanged = credential && credential.staff.id === staff.id && credential.staff.role === staff.role
      const salt = unchanged ? credential.salt : crypto.randomBytes(16).toString('hex')
      credential = { staff: { id: staff.id, name: staff.name, role: staff.role }, salt,
        hash: crypto.scryptSync(pin, salt, 32).toString('hex'), expires_at: now + this.ttl,
        revision: unchanged ? credential.revision : crypto.randomUUID(),
        devices: { ...(unchanged ? credential.devices : {}), [deviceId]: now + this.ttl } }
      for (const [oldIndex, old] of Object.entries(this.data.credentials)) if (old.staff.id === staff.id) delete this.data.credentials[oldIndex]
      this.data.credentials[index] = credential
      delete this.data.denied_devices[deviceId]
    } catch (error) {
      if (error.status) { this._anotarFallo(deviceId, now); this._persist(); throw error }
      offline = true
      if (this.data.denied_devices[deviceId]) throw fail('Terminal revocada; requiere autorización con internet', 403, 'terminal_not_enrolled')
      if (!credential || credential.expires_at <= now || !(credential.devices?.[deviceId] > now) || !equal(crypto.scryptSync(pin, credential.salt, 32).toString('hex'), credential.hash)) {
        this._anotarFallo(deviceId, now); this._persist()
        throw fail('Usuario o terminal sin preparar, o credencial vencida; valida PIN con internet', 401, 'OFFLINE_USER_NOT_PREPARED')
      }
    }
    // Entrar bien limpia el presupuesto de ESTA terminal: si no, los errores de
    // quien tecleó mal antes seguían contando contra quien ya se identificó.
    delete this.data.failures[deviceId]
    this._persist()
    if (minRole && LEVEL[normalizedRole(credential.staff.role)] < LEVEL[normalizedRole(minRole)]) throw fail('Este usuario no tiene el permiso solicitado', 403, 'PERMISSION_DENIED')
    const expiresAt = Math.min(now + 8 * 3600000, credential.expires_at)
    const payload = Buffer.from(JSON.stringify({ restaurant_id: this.restaurantId, location_id: this.branchId,
      device_id: deviceId, actor_id: credential.staff.id, revision: credential.revision, expires_at: expiresAt })).toString('base64url')
    return { staff: credential.staff, actor_token: payload + '.' + this._sign(payload), expires_at: expiresAt, offline, ...(shiftToken ? { shiftToken } : {}) }
  }
  verify(token, deviceId) {
    const now = this._time()
    if (typeof token !== 'string' || token.length > 4096) throw fail('Falta sesión de usuario')
    const [payload, signature, extra] = token.split('.')
    if (extra || !equal(this._sign(payload || ''), signature)) throw fail('Sesión de usuario inválida')
    let claims
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { throw fail('Sesión de usuario inválida') }
    if (claims.restaurant_id !== this.restaurantId || claims.location_id !== this.branchId || claims.device_id !== deviceId || !(claims.expires_at > now)) throw fail('Sesión vencida o de otra instalación/terminal')
    const credential = Object.values(this.data.credentials).find(c => c.staff.id === claims.actor_id && c.revision === claims.revision && c.expires_at > now)
    if (!credential || !(credential.devices?.[deviceId] > now) || this.data.denied_devices[deviceId]) throw fail('Usuario o terminal revocado o vencido')
    return { ...credential.staff, permissions: permissionsFor(credential.staff.role), device_id: deviceId, expires_at: claims.expires_at }
  }
}
module.exports = { ActorAuthority, permissionsFor }
