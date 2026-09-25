'use strict'
// Caja validates PINs against the configured HTTPS authority, then keeps a
// bounded verifier for prepared users/devices. Browser staff/role caches never
// authorize commands. Tokens are not written to the event log or snapshots.
//
// ── ALMACÉN SELLADO POR EL SO (bloque POS, 2026-09-24) ─────────────────────────
//
// Hasta hoy la llave HMAC vivía en `actor-signing-key` (texto) y los verificadores en
// `actor-credentials.json` (JSON plano), en la misma carpeta. El índice de cada credencial
// era HMAC(llave, 'pin:' + pin): con los dos archivos, 10^4 HMACs daban el PIN de cada
// persona preparada, sin pasar por scrypt y sin tocar la aplicación.
//
// Ahora:
//   · La llave y los datos se guardan SELLADOS por el protector del SO (protector-so.js:
//     DPAPI / Keychain vía safeStorage). Copiados a otra máquina no abren.
//   · Sin protector real la Caja NO guarda credenciales offline: valida con la nube y nada
//     más. Los archivos planos viejos se borran. Falla cerrado; nunca texto plano.
//   · Índice v2 = HMAC(llave, 'pin:v2:<restaurante>:<pin>').
//   · Migración: los datos planos existentes pasan SELLADOS como `legacy` con su llave
//     vieja (también sellada) y siguen sirviendo hasta que venzan (≤ 7 días) o hasta que esa
//     persona entre con red y se re-prepare en v2. Los archivos planos se borran al migrar.
//   · Revocación DURABLE: un 401 de la nube sobre una credencial conocida la borra y anota
//     `revocados[staff]`, que también invalida la entrada legacy y las sesiones emitidas. Y
//     después de cada entrada con red se sincroniza el roster (/api/pos/staff-roster): quien
//     ya no está activo se borra y quien cambió de rol queda con el rol nuevo.
//   · Recibos de aprobación offline (recibo-offline.js) con una llave por terminal que la
//     nube deriva y entrega a una sesión de gerente (/api/pos/terminal-receipt-key).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { replaceFile } = require('../adapters/storage/durable-file')
const permissionContract = require('./permission-profiles.json')
const { PROTECTOR_NO_DISPONIBLE } = require('./protector-so')
const { firmarRecibo } = require('./recibo-offline')

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
// Revisión adversarial E1 (2026-09-24): el bloqueo ESCALA y un éxito ya no borra los fallos.
// Antes, entrar con el propio PIN limpiaba el presupuesto de la terminal (y con él el de la
// instalación), así que un mesero intercalaba su PIN cada 9 intentos y recorría los 10^4 PINs
// sin red: encontró el del gerente en 4102 intentos sin un solo 429. Ahora: al agotar el
// presupuesto, bloqueo de 10 min que se duplica en cada reincidencia (tope 24 h); los fallos
// sólo vencen con el tiempo; el historial de bloqueos se olvida tras 24 h sin bloquear.
const BLOQUEO_BASE_MS   = 10 * 60000
const BLOQUEO_TOPE_MS   = 24 * 3600000
const OLVIDO_BLOQUEOS_MS = 24 * 3600000
// Revisión adversarial E7: con el reloj dudoso sólo se re-ancla si la nube contesta y su hora
// cuadra con la local.
const TOLERANCIA_RELOJ_MS = 5 * 60000
const ARCHIVO_SELLADO = 'actor-credentials.sealed'
const LLAVE_SELLADA = 'actor-signing-key.sealed'
const ARCHIVO_PLANO_VIEJO = 'actor-credentials.json'
const LLAVE_PLANA_VIEJA = 'actor-signing-key'
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
  constructor({ directory, restaurantId, branchId, cloudOrigin = 'https://app.fullsite.mx', fetchImpl = fetch, now = Date.now, credentialTtlMs = 7 * 86400000, cloudTimeoutMs = 5000, protector = PROTECTOR_NO_DISPONIBLE, terminalId = null }) {
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
    this.protector = protector || PROTECTOR_NO_DISPONIBLE
    this.protegido = this.protector.available === true
    this.terminalId = /^[\w-]{1,64}$/.test(terminalId || '') ? terminalId : null
    fs.mkdirSync(directory, { recursive: true })
    this.file = path.join(directory, ARCHIVO_SELLADO)
    this.keyFile = path.join(directory, LLAVE_SELLADA)
    const planoViejo = path.join(directory, ARCHIVO_PLANO_VIEJO)
    const llavePlanaVieja = path.join(directory, LLAVE_PLANA_VIEJA)
    this.data = this._vacio()

    if (!this.protegido) {
      // Sin protección real no hay almacén offline. Lo viejo en texto plano se BORRA: es
      // exactamente lo que no debe existir en disco.
      this.key = crypto.randomBytes(32).toString('hex')
      for (const f of [planoViejo, llavePlanaVieja]) { try { fs.rmSync(f, { force: true }) } catch { /* ignore */ } }
    } else {
      if (fs.existsSync(this.keyFile)) this.key = this._abrir(this.keyFile).trim()
      else { this.key = crypto.randomBytes(32).toString('hex'); replaceFile(this.keyFile, this.protector.seal(this.key)) }
      if (!/^[a-f0-9]{64}$/.test(this.key)) throw new Error('Clave de autoridad inválida')
      if (fs.existsSync(this.file)) this.data = this._validar(JSON.parse(this._abrir(this.file)))
      else if (fs.existsSync(planoViejo)) {
        // Migración única: lo plano entra SELLADO como legacy, con su llave vieja.
        const viejo = this._validar(JSON.parse(fs.readFileSync(planoViejo, 'utf8')))
        const llaveVieja = fs.existsSync(llavePlanaVieja) ? fs.readFileSync(llavePlanaVieja, 'utf8').trim() : ''
        this.data = { ...this._vacio(), failures: viejo.failures, denied_devices: viejo.denied_devices, last_seen: viejo.last_seen }
        if (/^[a-f0-9]{64}$/.test(llaveVieja) && Object.keys(viejo.credentials).length) {
          this.data.legacy = { key: llaveVieja, credentials: viejo.credentials }
        }
        this._persist()
      }
      // Tras sellar, lo plano no se queda en disco.
      for (const f of [planoViejo, llavePlanaVieja]) { try { fs.rmSync(f, { force: true }) } catch { /* ignore */ } }
    }
    this._queue = Promise.resolve()
    this._fondo = Promise.resolve()
    this._faulted = false
  }
  /** Serializa una mutación con los logins (mismo candado). */
  _enCola(fn) {
    const r = this._queue.then(fn)
    this._queue = r.catch(() => {})
    return r
  }
  _vacio() {
    return { credentials: {}, failures: {}, denied_devices: {}, last_seen: 0, revocados: {}, bloqueos: {} }
  }
  _abrir(archivo) {
    try { return this.protector.unseal(fs.readFileSync(archivo)) }
    catch { throw new Error('Credenciales dañadas o pertenecientes a otra instalación') }
  }
  _validar(data) {
    // Formato anterior: una lista plana sin terminal. No se puede repartir
    // entre terminales, así que se descarta. Son marcas de diez minutos como
    // mucho, y sólo ocurre una vez, al actualizar.
    if (Array.isArray(data.failures)) data.failures = {}
    if (!data.revocados || typeof data.revocados !== 'object') data.revocados = {}
    if (!data.bloqueos || typeof data.bloqueos !== 'object') data.bloqueos = {}
    if (data.restaurant_id !== this.restaurantId || data.location_id !== this.branchId ||
      !data.credentials || !data.failures || typeof data.failures !== 'object' ||
      !data.denied_devices || !Number.isFinite(data.last_seen)) {
      throw new Error('Credenciales dañadas o pertenecientes a otra instalación')
    }
    return data
  }
  _persist() {
    this.data.restaurant_id = this.restaurantId; this.data.location_id = this.branchId
    // Re-anclado (E7): tras confirmar la hora con la nube, `last_seen` puede BAJAR.
    this.data.last_seen = this._reanclar ? this.now() : Math.max(this.data.last_seen || 0, this.now())
    this._reanclar = false
    if (!this.protegido) return // sólo memoria: nada que se pueda robar del disco
    try { replaceFile(this.file, this.protector.seal(JSON.stringify(this.data))) }
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
    // Al agotar un presupuesto se BLOQUEA (escalando) y se vacía ese contador: el bloqueo, no
    // el contador, es lo que frena.
    if (this._fallosDe(deviceId, now).length >= INTENTOS_POR_TERMINAL) { this._bloquear(deviceId, now); delete this.data.failures[deviceId] }
    if (this._fallosDeLaInstalacion(now) >= INTENTOS_POR_INSTALACION) { this._bloquear('*', now); this.data.failures = {} }
  }
  _bloquear(ambito, now) {
    const b = this.data.bloqueos[ambito] || { strikes: 0, hasta: 0, ultimo: 0 }
    // El historial se olvida tras 24 h SIN ESTAR BLOQUEADO — contado desde que venció el último
    // bloqueo, no desde que empezó. Contado desde el inicio, un bloqueo de tope (24 h) ya
    // cumplía el olvido al vencer y la siguiente reincidencia volvía a 10 min: la escalada se
    // reiniciaba en ciclos (segunda revisión adversarial: 260 intentos offline en 7 días contra
    // la terminal del gerente, en vez de ~130).
    if (now - Math.max(b.hasta || 0, b.ultimo || 0) > OLVIDO_BLOQUEOS_MS) b.strikes = 0
    b.strikes += 1
    b.hasta = now + Math.min(BLOQUEO_BASE_MS * 2 ** (b.strikes - 1), BLOQUEO_TOPE_MS)
    b.ultimo = now
    this.data.bloqueos[ambito] = b
  }
  _bloqueado(ambito, now) {
    const b = this.data.bloqueos[ambito]
    return !!b && b.hasta > now
  }
  _time() {
    const { now, dudoso } = this._reloj()
    if (dudoso) throw fail('Reloj de Caja retrocedió; verificar hora antes de autorizar', 503, 'ACTOR_CLOCK_INVALID')
    return now
  }
  /** Como `_time`, pero no lanza por reloj: dice si está dudoso (E7). */
  _reloj() {
    if (this._faulted) throw fail('Reinicia y verifica el almacenamiento de Caja antes de autorizar', 503, 'ACTOR_STORAGE_UNAVAILABLE')
    const now = this.now()
    if (!Number.isFinite(now)) throw fail('Reloj de Caja inválido', 503, 'ACTOR_CLOCK_INVALID')
    return { now, dudoso: now + 60000 < this.data.last_seen }
  }
  _index(pin) { return crypto.createHmac('sha256', this.key).update('pin:v2:' + this.restaurantId + ':' + pin).digest('hex') }
  _legacyIndex(pin) { return this.data.legacy ? crypto.createHmac('sha256', this.data.legacy.key).update('pin:' + pin).digest('hex') : null }
  _sign(payload) { return crypto.createHmac('sha256', this.key).update(payload).digest('base64url') }
  /** Todas las credenciales vivas en memoria, v2 y legacy. */
  _todas() {
    return [...Object.values(this.data.credentials), ...Object.values(this.data.legacy?.credentials || {})]
  }
  /** ¿Esta credencial fue revocada DESPUÉS de prepararse? Las legacy no traen fecha: cualquier revocación las mata. */
  _revocada(credential) {
    const r = this.data.revocados[credential.staff.id]
    return Number.isFinite(r) && r >= (credential.prepared_at || 0)
  }
  /** Borra toda credencial (v2 y legacy) de una persona. */
  _olvidarPersona(staffId) {
    for (const [i, c] of Object.entries(this.data.credentials)) if (c.staff.id === staffId) delete this.data.credentials[i]
    if (this.data.legacy) {
      for (const [i, c] of Object.entries(this.data.legacy.credentials)) if (c.staff.id === staffId) delete this.data.legacy.credentials[i]
      if (!Object.keys(this.data.legacy.credentials).length) delete this.data.legacy
    }
  }
  status() {
    const now = this._time()
    const credentials = this._todas().filter(c => c.expires_at > now && !this._revocada(c))
    return { prepared_users: credentials.length, roles: [...new Set(credentials.map(c => c.staff.role))],
      expires_at: credentials.length ? Math.min(...credentials.map(c => c.expires_at)) : null,
      ready: credentials.length > 0, max_validity_ms: this.ttl,
      offline_protegido: this.protegido, protector: this.protector.nombre || null,
      recibos_offline: !!this.data.recibos,
      policy: this.protegido
        ? 'Cada usuario y terminal deben validar PIN con internet antes del corte WAN'
        : 'Sin protección del sistema operativo: esta Caja no guarda credenciales offline' }
  }
  /** Espera a que terminen las tareas de fondo (roster, llave de recibos). Para pruebas y apagado. */
  async idle() { await this._fondo; await this._queue }
  login(input) {
    // Includes throttle, network validation and durable write. Concurrent PINs
    // cannot all observe the same attempt budget or overwrite revocations.
    const result = this._queue.then(() => this._login(input))
    this._queue = result.catch(() => {})
    return result.then(r => {
      const { _fondo, ...publico } = r
      // Las consultas de fondo corren FUERA de la cola (una nube lenta no debe demorar el
      // siguiente PIN); sólo aplicar su resultado pasa por la cola.
      if (_fondo?.length) {
        const corriendo = Promise.all(_fondo.map(t => t().catch(() => {})))
        this._fondo = Promise.all([this._fondo, corriendo])
      }
      return publico
    })
  }
  async _login({ pin, deviceId, restaurantId, minRole, aprobacion = false }) {
    const { now, dudoso: relojDudoso } = this._reloj()
    if (restaurantId !== this.restaurantId || !/^[\w-]{1,64}$/.test(deviceId || '')) throw fail('Scope de acceso inválido', 403, 'ACTOR_SCOPE_INVALID')
    if (!/^\d{4,10}$/.test(pin || '')) throw fail('PIN inválido', 400, 'INVALID_PIN')
    if (minRole && !LEVEL[normalizedRole(minRole)]) throw fail('Permiso solicitado inválido', 400, 'INVALID_ROLE')
    if (this._bloqueado(deviceId, now)) {
      throw fail('Demasiados intentos en esta terminal; espera antes de volver a intentar', 429, 'PIN_RATE_LIMITED')
    }
    if (this._bloqueado('*', now)) {
      throw fail('Demasiados intentos en el restaurante; espera antes de volver a intentar', 429, 'PIN_RATE_LIMITED')
    }
    const index = this._index(pin)
    const legacyIndex = this._legacyIndex(pin)
    let credential = this.data.credentials[index] || (legacyIndex ? this.data.legacy.credentials[legacyIndex] : undefined)
    let offline = false, shiftToken, approvalToken
    try {
      const response = await this.fetch(this.cloudOrigin + '/api/pos/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
        // `aprobacion` pide a la nube un token de APROBACIÓN (15 min, jti, terminal) sin
        // filtrar por rol: el rol mínimo se revisa aquí abajo. Filtrar en la nube haría que
        // el 401 de «no alcanza el rol» borrara la credencial de alguien que sí es válido.
        body: JSON.stringify({ pin, client_id: this.restaurantId, device_id: deviceId, ...(aprobacion ? { aprobacion: true } : {}) }),
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
        // A device rejection is not an employee revocation. A firm invalid PIN does
        // revoke its cached verifier and every issued session — y ahora DURABLE: si la
        // credencial era de alguien conocido, esa persona queda anotada en `revocados`,
        // lo que mata también su entrada legacy (otro PIN viejo) y sus sesiones.
        else if (response.status === 401) {
          if (credential) { this.data.revocados[credential.staff.id] = now; this._olvidarPersona(credential.staff.id) }
          delete this.data.credentials[index]
          if (legacyIndex && this.data.legacy) delete this.data.legacy.credentials[legacyIndex]
        }
        throw fail(rejection.code === 'terminal_not_enrolled' ? 'Terminal no autorizada' : 'PIN rechazado por la autoridad', response.status, rejection.code || 'PIN_REJECTED')
      }
      if (!response.ok) throw new Error('Autoridad no disponible')
      const data = await response.json()
      const staff = data.staff
      if (typeof staff?.id !== 'string' || !staff.id || typeof staff.name !== 'string' || !LEVEL[normalizedRole(staff.role)]) throw fail('Respuesta de autoridad inválida', 502, 'AUTHORITY_RESPONSE_INVALID')
      shiftToken = typeof data.shiftToken === 'string' ? data.shiftToken : undefined
      approvalToken = typeof data.approvalToken === 'string' ? data.approvalToken : undefined
      if (relojDudoso) {
        // E7: el reloj local quedó por detrás de `last_seen`. Con la nube confirmando la hora,
        // se re-ancla; si la nube no la da o no cuadra, no se autoriza nada.
        const horaNube = Date.parse(response.headers?.get?.('date') || '')
        if (!Number.isFinite(horaNube) || Math.abs(horaNube - now) > TOLERANCIA_RELOJ_MS) {
          throw fail('Reloj de Caja no coincide con la hora de la nube; corrige la hora', 503, 'ACTOR_CLOCK_INVALID')
        }
        this._reanclar = true
      }
      const unchanged = credential && credential.staff.id === staff.id && credential.staff.role === staff.role && credential.prepared_at
      const salt = unchanged ? credential.salt : crypto.randomBytes(16).toString('hex')
      credential = { staff: { id: staff.id, name: staff.name, role: staff.role }, salt,
        hash: crypto.scryptSync(pin, salt, 32).toString('hex'), expires_at: now + this.ttl, prepared_at: now,
        // Revisión de credencial de la nube (E5): cambia cuando cambia el PIN.
        ...(typeof data.cred_rev === 'string' ? { cred_rev: data.cred_rev } : {}),
        revision: unchanged ? credential.revision : crypto.randomUUID(),
        devices: { ...(unchanged ? credential.devices : {}), [deviceId]: now + this.ttl } }
      // La nube acaba de confirmar a esta persona: si estaba revocada, deja de estarlo.
      delete this.data.revocados[staff.id]
      this._olvidarPersona(staff.id)
      // Sin protector se guarda SÓLO en memoria (para verificar las sesiones de este
      // arranque); `_persist` no escribe nada y el camino offline está cerrado.
      this.data.credentials[index] = credential
      delete this.data.denied_devices[deviceId]
    } catch (error) {
      if (error.code === 'ACTOR_CLOCK_INVALID') throw error
      if (error.status) { this._anotarFallo(deviceId, now); this._persist(); throw error }
      offline = true
      if (relojDudoso) throw fail('Reloj de Caja retrocedió; sin internet no se puede verificar la hora', 503, 'ACTOR_CLOCK_INVALID')
      if (!this.protegido) {
        throw fail('Esta Caja no tiene protección del sistema operativo para guardar credenciales; sin internet no puede validar PINs', 503, 'OFFLINE_SIN_PROTECCION')
      }
      if (this.data.denied_devices[deviceId]) throw fail('Terminal revocada; requiere autorización con internet', 403, 'terminal_not_enrolled')
      if (!credential || this._revocada(credential) || credential.expires_at <= now || !(credential.devices?.[deviceId] > now) || !equal(crypto.scryptSync(pin, credential.salt, 32).toString('hex'), credential.hash)) {
        this._anotarFallo(deviceId, now); this._persist()
        throw fail('Usuario o terminal sin preparar, o credencial vencida; valida PIN con internet', 401, 'OFFLINE_USER_NOT_PREPARED')
      }
    }
    // Entrar bien YA NO limpia el presupuesto (revisión adversarial E1): intercalar el propio
    // PIN reiniciaba el contador y permitía recorrer los 10^4 PINs sin red. Los fallos vencen
    // solos a los 10 minutos.
    this._persist()
    if (minRole && LEVEL[normalizedRole(credential.staff.role)] < LEVEL[normalizedRole(minRole)]) throw fail('Este usuario no tiene el permiso solicitado', 403, 'PERMISSION_DENIED')
    if (aprobacion) {
      // Revisión adversarial E4: una APROBACIÓN no es un login. Antes devolvía también el
      // actor_token (sesión de 8 h con los permisos del gerente) y el shiftToken de la nube: la
      // terminal del mesero se quedaba con una sesión de gerente. Ahora sólo quién aprobó y la
      // prueba de la aprobación (token de la nube con red; recibo firmado sin red).
      let recibo
      if (offline && this.data.recibos) {
        recibo = firmarRecibo(this.data.recibos.key, { cid: this.restaurantId, tid: this.data.recibos.tid, req: deviceId,
          sub: credential.staff.id, nam: credential.staff.name, rol: credential.staff.role, kid: this.data.recibos.kid, now })
      }
      return { staff: credential.staff, offline, ...(approvalToken ? { approvalToken } : {}), ...(recibo ? { recibo } : {}), _fondo: [] }
    }
    const expiresAt = Math.min(now + 8 * 3600000, credential.expires_at)
    const payload = Buffer.from(JSON.stringify({ restaurant_id: this.restaurantId, location_id: this.branchId,
      device_id: deviceId, actor_id: credential.staff.id, revision: credential.revision, iat: now, expires_at: expiresAt })).toString('base64url')
    const fondo = []
    if (!offline && shiftToken) {
      fondo.push(() => this._sincronizarRoster(shiftToken))
      // La llave de recibos es de ESTA terminal (V2): sólo con la sesión de un gerente que
      // entró EN la Caja — el servidor exige que el token se haya emitido para esa terminal.
      if (this.protegido && this.terminalId && deviceId === this.terminalId && LEVEL[normalizedRole(credential.staff.role)] >= LEVEL.gerente) {
        fondo.push(() => this._obtenerLlaveDeRecibos(shiftToken))
      }
    }
    return { staff: credential.staff, actor_token: payload + '.' + this._sign(payload), expires_at: expiresAt, offline,
      ...(shiftToken ? { shiftToken } : {}), _fondo: fondo }
  }
  /**
   * Roster: quién sigue activo y con qué rol. Sin esto, un empleado dado de baja seguía
   * entrando offline con su credencial preparada hasta 7 días, mientras no tecleara su PIN
   * con red (que es lo que dispara el 401). Best-effort: si la nube no contesta, no pasa
   * nada; cuando contesta, lo que decide es durable.
   */
  async _sincronizarRoster(shiftToken) {
    const r = await this.fetch(this.cloudOrigin + '/api/pos/staff-roster', {
      method: 'GET', headers: { Authorization: `Bearer ${shiftToken}` }, redirect: 'error',
      signal: AbortSignal.timeout(this.cloudTimeoutMs),
    })
    if (!r.ok) return
    const cuerpo = await r.json().catch(() => null)
    if (!cuerpo || cuerpo.client_id !== this.restaurantId || !Array.isArray(cuerpo.staff)) return
    await this._enCola(() => this._aplicarRoster(cuerpo))
  }
  _aplicarRoster(cuerpo) {
    const now = this._time()
    // E3: un roster VIEJO que llega tarde no manda. Sólo se aplica uno más nuevo que el último.
    if (!Number.isFinite(cuerpo.as_of) || cuerpo.as_of <= (this.data.roster_as_of_srv || 0)) return
    // E6: un roster vacío no es «todos fueron dados de baja»; es un error. No se aplica.
    if (!cuerpo.staff.length) return
    const activos = new Map()
    for (const s of cuerpo.staff) if (typeof s?.id === 'string' && LEVEL[normalizedRole(s.role)]) activos.set(s.id, s)
    const personas = new Map(this._todas().map(c => [c.staff.id, c]))
    const aBorrar = [...personas.keys()].filter(id => {
      const r = activos.get(id), c = personas.get(id)
      return !r || (typeof r.cred_rev === 'string' && typeof c.cred_rev === 'string' && r.cred_rev !== c.cred_rev)
    })
    // E6: borrar a la mayoría de un golpe (≥ 4 personas preparadas) se trata como roster roto.
    if (personas.size >= 4 && aBorrar.length * 2 > personas.size) return
    for (const id of aBorrar) { this.data.revocados[id] = now; this._olvidarPersona(id) }
    for (const c of this._todas()) {
      const r = activos.get(c.staff.id)
      // E3: el roster sólo BAJA roles. Subir un rol lo decide la nube en un login con PIN.
      if (r && LEVEL[normalizedRole(r.role)] < LEVEL[normalizedRole(c.staff.role)]) {
        c.staff.role = r.role; c.revision = crypto.randomUUID()
      }
    }
    this.data.roster_as_of = now
    this.data.roster_as_of_srv = cuerpo.as_of
    this._persist()
  }
  /** Llave de recibos offline para ESTA terminal. Sólo con sesión de gerente y almacén sellado. */
  async _obtenerLlaveDeRecibos(shiftToken) {
    if (!this.protegido || !this.terminalId) return
    const r = await this.fetch(this.cloudOrigin + '/api/pos/terminal-receipt-key', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${shiftToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: this.terminalId }),
      signal: AbortSignal.timeout(this.cloudTimeoutMs),
    })
    if (!r.ok) return
    const cuerpo = await r.json().catch(() => null)
    if (!cuerpo || !/^[a-f0-9]{64}$/.test(cuerpo.key || '') || typeof cuerpo.kid !== 'string' || cuerpo.device_id !== this.terminalId) return
    await this._enCola(() => {
      this.data.recibos = { kid: cuerpo.kid, key: cuerpo.key, tid: this.terminalId, recibido_at: this._time() }
      this._persist()
    })
  }
  verify(token, deviceId) {
    const now = this._time()
    if (typeof token !== 'string' || token.length > 4096) throw fail('Falta sesión de usuario')
    const [payload, signature, extra] = token.split('.')
    if (extra || !equal(this._sign(payload || ''), signature)) throw fail('Sesión de usuario inválida')
    let claims
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { throw fail('Sesión de usuario inválida') }
    if (claims.restaurant_id !== this.restaurantId || claims.location_id !== this.branchId || claims.device_id !== deviceId || !(claims.expires_at > now)) throw fail('Sesión vencida o de otra instalación/terminal')
    const credential = this._todas().find(c => c.staff.id === claims.actor_id && c.revision === claims.revision && c.expires_at > now)
    const revocadoDespues = Number.isFinite(this.data.revocados[claims.actor_id]) && this.data.revocados[claims.actor_id] >= (claims.iat || 0)
    if (!credential || revocadoDespues || !(credential.devices?.[deviceId] > now) || this.data.denied_devices[deviceId]) throw fail('Usuario o terminal revocado o vencido')
    return { ...credential.staff, permissions: permissionsFor(credential.staff.role), device_id: deviceId, expires_at: claims.expires_at }
  }
}
module.exports = { ActorAuthority, permissionsFor }
