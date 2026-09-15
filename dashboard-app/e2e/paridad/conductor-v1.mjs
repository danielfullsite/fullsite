// EL CONDUCTOR — ejecuta un guion de INTENCIONES contra el POS vivo y captura
// lo que el POS tocó, sin dejar que nada salga.
//
// El guion no sabe de botones. Dice «agregar producto», no «clic en el tercer
// mosaico». Por eso sobrevive al rediseño — que es el punto entero: el mismo
// guion tiene que poder correr contra V1 y contra V2.
//
// ── MODO CAPTURE_ONLY ───────────────────────────────────────────────────────
// Toda escritura se intercepta y NO sale: las rutas `/api/**` se contestan
// desde aquí, y lo que iba a IndexedDB, a Pedro, a la impresora o al cajón se
// anota sin ejecutarse. Se puede correr mil veces sin escribir un peso ni
// mover una mesa. Es lo que lo vuelve seguro para CI.
//
// ── LO QUE ESTE ARCHIVO NO HACE ─────────────────────────────────────────────
// No decide si V1 y V2 son iguales. Sólo produce el manifiesto. La comparación
// vive en `manifiesto-de-efectos.mjs`, y separarlas importa: un conductor que
// además juzgara podría taparse sus propios huecos.
//
//   node conductor-v1.mjs [--mesa 7]

// `playwright` es dependencia de dashboard-app, así que el nombre simple
// resuelve desde cualquier punto del paquete. La versión anterior traía una RUTA
// ABSOLUTA a un worktree hermano: funcionaba en la máquina donde se escribió y
// moría en cualquier otra —incluida ésta, en cuanto ese worktree se limpió—.
// Un arnés de certificación que sólo corre en un disco concreto no certifica.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { vacio } from './manifiesto-de-efectos.mjs'
import { OBJETIVO, ENTORNO, G01 as GUION_G01 } from './cert/objetivo-g01.mjs'

// El PIN no tiene default. Un PIN adivinado produce un fallo de autenticación
// que se lee como defecto del producto — el error que ya costó dos corridas.
// Sin PIN, la compuerta G-8 del preflight detiene la corrida antes de empezar.
const PIN = process.env.FULLSITE_PIN || ''

/* ═══════════════════════════════════════════════════════════════════════════
   LA SONDA — se inyecta ANTES de que cargue la página
   ───────────────────────────────────────────────────────────────────────────
   Envuelve los puntos por donde el POS toca el mundo. Se instala en
   `addInitScript` para que exista antes que el código de la aplicación: si se
   instalara después, los efectos del arranque se perderían y el manifiesto
   diría «no pasó nada» cuando sí pasó. Ése es el error que este arnés existe
   para no cometer.
   ═══════════════════════════════════════════════════════════════════════════ */
const SONDA = () => {
  const efectos = []
  const anotar = (categoria, dato) => efectos.push({ categoria, dato, t: Date.now() })
  window.__efectos = efectos

  // 1 · fetch — la frontera principal. En CAPTURE_ONLY nada sale.
  const fetchReal = window.fetch.bind(window)
  window.fetch = async (entrada, opciones = {}) => {
    const url = typeof entrada === 'string' ? entrada : (entrada?.url || String(entrada))
    const metodo = (opciones.method || (entrada && entrada.method) || 'GET').toUpperCase()
    const esEscritura = metodo !== 'GET' && metodo !== 'HEAD'

    // Pedro vive en la LAN; sus avisos son efectos aparte.
    const esPedro = /127\.0\.0\.1:7717|:7717\//.test(url)

    // ── LA AUTENTICACIÓN NO SE INTERCEPTA ───────────────────────────────────
    //
    // Entrar al sistema es una PRECONDICIÓN del guion, no uno de los efectos que
    // el guion mide. Interceptarla rompe el guion entero y —lo peor— el fallo se
    // disfraza de defecto del producto.
    //
    // Es exactamente lo que pasó: la sonda se tragaba el POST del PIN y devolvía
    // `{ok:true, capturado:true}`, un cuerpo sin `staff.id` ni `actor_token`. El
    // POS hacía lo correcto —rechazarlo— y mostraba «Caja no confirmó la
    // sesión». Se leyó como «el POS no deja entrar» durante dos corridas.
    //
    // Las rutas de identidad pasan ÍNTEGRAS al Pedro real. No mueven dinero, no
    // mueven mesas, no escriben órdenes: no son lo que este arnés compara.
    const esAutenticacion = /\/auth\/|\/fp\/|\/identity|\/api\/pos\/pin/.test(url)

    // ── SUPABASE REST TAMBIÉN SE INTERCEPTA ─────────────────────────────────
    //
    // `logAudit` (pos-data.ts:2025) NO pasa por `/api/`: postea derecho a
    // `${SUPABASE_URL}/rest/v1/pos_audit_log`. Con la condición anterior
    // —`url.includes('/api/') || esPedro`— se ESCAPABA: en modo CAPTURE_ONLY
    // escribía de verdad en la base del tenant. Dos consecuencias, las dos
    // malas: la promesa de «cero escrituras» era falsa, y `audit_events`
    // quedaba siempre vacío, así que la mutación M2 nunca era aplicable.
    const esSupabaseRest = /\/rest\/v1\//.test(url)

    if (esEscritura && !esAutenticacion && (url.includes('/api/') || esPedro || esSupabaseRest)) {
      let cuerpo = null
      try { cuerpo = opciones.body ? JSON.parse(opciones.body) : null } catch { cuerpo = '(no es JSON)' }
      const ruta = url.replace(/^https?:\/\/[^/]+/, '')

      // ── EL REPARTO POR CATEGORÍA ──────────────────────────────────────────
      //
      // Antes todo lo de Pedro caía junto en `pedro_events`, y cinco de las
      // diez categorías del manifiesto quedaban muertas para siempre. Muertas
      // las categorías, muertas las mutaciones que las vigilan: M1 y M3
      // (kds_events) y M2 (audit_events) devolvían `null` y el arnés lo
      // imprimía como «?? no aplicable» sin fallar.
      //
      // Pedro ya expone las rutas separadas (`/print`, `/drawer`, `/events`);
      // repartirlas no es plomería nueva, es dejar de tirar la información.
      if (esPedro) {
        if (/\/print\b/.test(ruta)) {
          anotar('print_jobs', { estacion: cuerpo?.station ?? cuerpo?.estacion ?? null,
            tipo: cuerpo?.type ?? cuerpo?.tipo ?? 'comanda', ancho: cuerpo?.width ?? cuerpo?.ancho ?? null })
        } else if (/\/drawer\b/.test(ruta)) {
          anotar('cash_drawer', { accion: cuerpo?.action ?? cuerpo?.accion ?? 'abrir' })
        } else if (/\/events\b/.test(ruta)) {
          anotar('pedro_events', { tipo: cuerpo?.command_type ?? null, mesa: cuerpo?.mesa ?? null })
          // La comanda, en la forma canónica que el comparador y las cinco
          // mutaciones esperan: una entrada por estación.
          for (const ev of comandaPorEstacion(cuerpo)) anotar('kds_events', ev)
        } else {
          anotar('pedro_events', { metodo, url: ruta, cuerpo: resumir(cuerpo) })
        }
      } else if (esSupabaseRest) {
        const tabla = (ruta.match(/\/rest\/v1\/([a-zA-Z0-9_]+)/) || [])[1] || '(desconocida)'
        if (tabla === 'pos_audit_log') {
          anotar('audit_events', { action: cuerpo?.action ?? null, actor: cuerpo?.actor ?? null,
            order_id: cuerpo?.order_id ?? null, mesa: cuerpo?.mesa ?? null })
        } else {
          anotar('api_writes', { metodo, tabla, endpoint: `/rest/v1/${tabla}`, cuerpo: resumir(cuerpo) })
        }
      } else {
        anotar('api_writes', { metodo, url: ruta, cuerpo: resumir(cuerpo) })
      }

      // NO SALE. Se contesta con algo verosímil para que el flujo siga.
      return new Response(JSON.stringify({ ok: true, capturado: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return fetchReal(entrada, opciones)
  }

  /**
   * Convierte un ORDER_SENT en comandas por estación.
   *
   * La forma —`{estacion, mesa, items:[{n,q,mods}]}`— no es inventada aquí: es
   * la que ya declara el fixture de `probar-el-comparador.mjs` y la que las
   * mutaciones M1 (`items[0].q`) y M3 (`estacion`) manipulan. Alinear la
   * captura real a esa forma es lo que convierte ese fixture en un contrato
   * en vez de una ficción que sólo se prueba consigo misma.
   */
  function comandaPorEstacion(cuerpo) {
    const items = Array.isArray(cuerpo?.items) ? cuerpo.items : []
    if (!items.length) return []
    const porEstacion = new Map()
    for (const it of items) {
      const est = it.station || it.estacion || 'cocina'
      if (!porEstacion.has(est)) porEstacion.set(est, [])
      porEstacion.get(est).push({
        n: it.nombre ?? it.name ?? null,
        q: it.cantidad ?? it.qty ?? it.q ?? 1,
        mods: Array.isArray(it.modificadores) ? [...it.modificadores]
            : Array.isArray(it.mods) ? [...it.mods] : [],
      })
    }
    return [...porEstacion.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([estacion, items]) => ({ estacion, mesa: cuerpo?.mesa ?? null, items }))
  }

  // 2 · IndexedDB — la cola durable y el caché de órdenes.
  const putReal = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (valor, llave) {
    anotar('local_db_writes', { store: this.name, op: 'put', llave: llave ?? valor?.id ?? null,
      resumen: resumir(valor) })
    return putReal.call(this, valor, llave)   // sí se escribe: es local y desechable
  }
  const addReal = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function (valor, llave) {
    anotar('local_db_writes', { store: this.name, op: 'add', llave: llave ?? valor?.id ?? null,
      resumen: resumir(valor) })
    return addReal.call(this, valor, llave)
  }

  // 3 · La cola de sincronización, que es lo que sube después.
  //    Se lee del mismo localStorage que usa el POS como buffer de emergencia.
  const setItemReal = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) {
    if (/pos_sync_queue|pos_pending|pos_order_/.test(k)) {
      anotar('sync_queue', { clave: k, resumen: resumir(safeParse(v)) })
    }
    return setItemReal.call(this, k, v)
  }

  function safeParse(v) { try { return JSON.parse(v) } catch { return v } }
  /** Sólo lo que importa para comparar: nada de payloads completos en el acta. */
  function resumir(v) {
    if (!v || typeof v !== 'object') return v
    const o = Array.isArray(v) ? v[0] : v
    if (!o || typeof o !== 'object') return v
    const campos = ['id', 'order_id', 'mesa', 'status', 'subtotal', 'iva', 'total', 'descuento',
      'propina', 'metodo_pago', 'table', 'method', 'endpoint', 'transport', 'save_operation_id']
    const r = {}
    for (const c of campos) if (o[c] !== undefined) r[c] = o[c]
    if (Array.isArray(v)) r._n = v.length
    return r
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL CONDUCTOR
   ═══════════════════════════════════════════════════════════════════════════ */

export async function conducirV1(guion, opciones = {}) {
  const {
    mesa       = OBJETIVO.mesa,
    objetivo   = OBJETIVO,
    baseUrl    = ENTORNO.baseUrl,
    cdp        = ENTORNO.cdp,
    evidencia  = null,          // directorio para screenshots y traza; null = sin evidencia
    corridaId  = 'run',
  } = opciones

  const nav = await chromium.connectOverCDP(cdp)
  const ctx = nav.contexts()[0]
  await ctx.addInitScript(SONDA)

  // ── EVIDENCIA SIEMPRE, NO SÓLO AL FALLAR ────────────────────────────────
  // Los configs de Playwright del repo usan `trace: 'on-first-retry'` y
  // `screenshot: 'only-on-failure'`: eso sirve para depurar, no para
  // certificar. Un PASS sin captura de cada paso no se puede auditar después.
  let traza = null
  if (evidencia) {
    mkdirSync(evidencia, { recursive: true })
    traza = join(evidencia, `traza-${corridaId}.zip`)
    await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false }).catch(() => { traza = null })
  }

  const page = ctx.pages().find(p => p.url().includes('/pos')) || ctx.pages()[0]
  const manifiesto = vacio()
  const bitacora = []
  const pasos = []            // un registro por paso del guion, con su causa de fallo

  /** Captura de pantalla de un paso. Nunca tumba la corrida si falla. */
  const retratar = async (n, nombre) => {
    if (!evidencia) return null
    const archivo = join(evidencia, `${corridaId}-paso-${String(n).padStart(2, '0')}.png`)
    try { await page.screenshot({ path: archivo, fullPage: false }); return archivo } catch { return null }
  }

  /**
   * Pulsa por SIGNIFICADO. Nunca se traga un fallo.
   *
   * EL NOMBRE DE UN CONTROL NO ES SU TEXTO. El botón de confirmar el PIN se
   * dibuja como un icono: `innerText` vacío y `aria-label="Entrar"`. Un buscador
   * que sólo mire el texto no lo ve y reporta «no está» sobre un botón que
   * cualquiera tiene enfrente. Eso tumbó la primera corrida completa de G01 —
   * y peor: el fallo se parecía a un defecto del producto.
   *
   * Orden de búsqueda, del identificador más estable al más frágil:
   *   1. data-testid — puesto a propósito para esto
   *   2. aria-label  — el nombre accesible
   *   3. title       — la alternativa de varios controles
   *   4. innerText   — el último, porque el rediseño lo cambia
   *
   * Y se distingue DESHABILITADO de AUSENTE: no son lo mismo, y confundirlos
   * manda a buscar por el lado equivocado.
   */
  const pulsar = async (patron, etiqueta = patron) => {
    const r = await page.evaluate(p => {
      const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
      const re = new RegExp(p, 'i')
      const nombres = el => [
        el.getAttribute('data-testid'),
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        (el.innerText || '').replace(/\s+/g, ' ').trim(),
      ].filter(Boolean)
      const controles = [...document.querySelectorAll('button,[role=button]')].filter(vis)
      const inventario = () => controles.map(x => nombres(x)[0] || '(sin nombre)').slice(0, 30)
      const b = controles.find(x => nombres(x).some(n => re.test(n)))
      if (!b) return { ok: false, motivo: 'no está en pantalla', enPantalla: inventario() }
      const rotulo = nombres(b)[0]
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') {
        return { ok: false, motivo: 'está deshabilitado', rotulo, enPantalla: inventario() }
      }
      b.click()
      return { ok: true, rotulo }
    }, patron)
    bitacora.push({ etiqueta, ...r })
    return r
  }

  /** ¿Está puesta la pantalla de bloqueo? */
  const estaBloqueado = async () => {
    const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')).catch(() => '')
    return /PIN para abrir|Huella digital o PIN|Ingresa tu PIN/i.test(t)
  }

  /**
   * Entra con el PIN. Devuelve un resultado, no `void`.
   *
   * El POS regresa al PIN tras cada acción —es diseño, no bug—, así que esto se
   * llama también DESPUÉS de abrir mesa y de enviar. Cuando no hay pantalla de
   * bloqueo devuelve ok sin tocar nada: idempotente a propósito.
   *
   * Que devuelva resultado es el cambio que importa: como paso 1 del guion, un
   * PIN que no entra tiene que reportarse como el paso 1 fallando, no como «no
   * abrió la mesa».
   */
  const ingresarConPin = async () => {
    if (!await estaBloqueado()) return { ok: true, rotulo: '(sin pantalla de bloqueo)' }
    if (!PIN) return { ok: false, motivo: 'FULLSITE_PIN no está definido', enPantalla: [] }

    for (const d of PIN.split('')) {
      await page.getByRole('button', { name: new RegExp(`^${d}$`) }).first().click().catch(() => {})
      await page.waitForTimeout(130)
    }
    // El confirmar es un icono sin texto: se busca por nombre accesible, y sólo
    // está habilitado con el PIN completo.
    const r = await pulsar('^Entrar$', 'confirmar PIN')
    await page.waitForTimeout(3500)
    if (r.ok === false) return r

    // Se comprueba el EFECTO, no el clic. Un «Entrar» que se pulsa y deja la
    // pantalla de bloqueo puesta no entró — y ahí nace «Caja no confirmó la
    // sesión», que es una precondición del laboratorio, no un defecto del POS.
    if (await estaBloqueado()) {
      const visible = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 220)).catch(() => '')
      return { ok: false, motivo: 'el PIN se envió y la pantalla de bloqueo siguió puesta', enPantalla: [visible] }
    }
    return { ok: true, rotulo: 'PIN aceptado' }
  }

  /**
   * El estado de la compuerta del modificador obligatorio.
   *
   * La ley: con un grupo obligatorio, el botón de confirmar se RENOMBRA a
   * «Elige <GRUPO>» y queda deshabilitado. Que el POS lo impida es la
   * funcionalidad; comprobarlo es parte del paso 5.
   */
  const estadoModificador = async () => await page.evaluate(() => {
    const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
    const bs = [...document.querySelectorAll('button')].filter(vis)
    const elige = bs.find(b => /^Elige\s+/i.test((b.innerText || '').trim()))
    const agregar = bs.find(b => /^Agregar\s+\$/i.test((b.innerText || '').trim()))
    return {
      exigido: !!elige,
      rotulo: (elige || agregar)?.innerText?.trim() || null,
      deshabilitado: !!(elige && (elige.disabled || elige.getAttribute('aria-disabled') === 'true')),
      enPantalla: bs.map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 20),
    }
  }).catch(() => ({ exigido: false, rotulo: null, deshabilitado: false, enPantalla: [] }))

  /** Cierra la traza. Si no se pudo abrir, no pasa nada. */
  const detenerTraza = async () => {
    if (!traza) return
    await ctx.tracing.stop({ path: traza }).catch(() => { traza = null })
  }

  const recoger = async () => {
    const efs = await page.evaluate(() => { const e = window.__efectos || []; window.__efectos = []; return e })
      .catch(() => [])
    for (const e of efs) (manifiesto[e.categoria] ||= []).push(e.dato)
  }

  /* ═════════════════════════════════════════════════════════════════════════
     LOS SEIS PASOS
     ─────────────────────────────────────────────────────────────────────────
     La versión anterior tenía cuatro acciones para seis pasos: el PIN vivía
     escondido dentro de «abrir mesa», y «elegir categoría» venía pegado a
     «agregar producto». Contar 6/6 exige que cada paso pueda fallar SOLO — con
     el PIN dentro de otro paso, un PIN roto se reportaba como «no abrió la
     mesa», y eso manda a buscar por el lado equivocado.

     Cada paso declara a quién se le imputa su ausencia:

       · `precondicion` — el dato tenía que estar sembrado en el tenant (mesa,
         categoría, producto, opción del modificador). Que falte NO es defecto
         del producto: es que el laboratorio no está listo.
       · `arnes` — el control es estructural del POS (teclado del PIN, botón de
         enviar). Que el arnés no lo encuentre es problema del arnés, y jamás
         se promueve a defecto: un paso que no se ejecutó no observó nada.
     ═════════════════════════════════════════════════════════════════════════ */
  const registrar = async (paso, r, extra = {}) => {
    const png = await retratar(paso.n, paso.accion)
    pasos.push({
      n: paso.n, accion: paso.accion, etiqueta: paso.etiqueta,
      ok: r.ok !== false,
      motivo: r.ok === false ? (r.motivo ?? 'no se ejecutó') : null,
      causa: r.ok === false ? (paso.causaSiFalta ?? 'arnes') : null,
      rotulo: r.rotulo ?? null,
      enPantalla: r.ok === false ? (r.enPantalla ?? []).slice(0, 12) : undefined,
      evidencia: png,
      ...extra,
    })
    return r
  }

  const causaDe = (accion) => (
    ['abrirMesa', 'elegirCategoria', 'agregarProducto', 'completarModificador'].includes(accion)
      ? 'precondicion' : 'arnes'
  )

  for (const paso of guion.pasos) {
    paso.causaSiFalta = paso.causaSiFalta ?? causaDe(paso.accion)
    switch (paso.accion) {
      // ── 1 · PIN / login — es un PASO, no un preámbulo ────────────────────
      case 'ingresar': {
        await page.goto(`${baseUrl}/pos/mesas`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await page.waitForTimeout(4000)
        const r = await ingresarConPin()
        await registrar(paso, r)
        break
      }

      // ── 2 · Abrir la mesa ────────────────────────────────────────────────
      case 'abrirMesa': {
        const n = paso.mesa ?? mesa
        const r = await pulsar(`^${n}\\s+(Disponible|Ocupada)`, `abrir mesa ${n}`)
        await page.waitForTimeout(3500); await ingresarConPin(); await page.waitForTimeout(2000)
        await registrar(paso, r)
        // El estado de la mesa es una de las diez categorías del manifiesto y
        // estaba muerta: se lee de la pantalla, que es lo que ve el mesero.
        const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')).catch(() => '')
        manifiesto.table_state.push({ mesa: n, abierta: r.ok === true,
          importes: (t.match(/\$[\d,]+\.\d{2}/g) || []).slice(0, 4) })
        break
      }

      // ── 3 · Elegir la categoría ──────────────────────────────────────────
      case 'elegirCategoria': {
        const r = await pulsar(`^${escapar(objetivo.categoria)}`, `categoría ${objetivo.categoria}`)
        await page.waitForTimeout(1800)
        await registrar(paso, r)
        break
      }

      // ── 4 · Agregar el producto ──────────────────────────────────────────
      case 'agregarProducto': {
        const r = await pulsar(escapar(objetivo.producto), `producto ${objetivo.producto}`)
        await page.waitForTimeout(2200)
        await registrar(paso, r)
        break
      }

      // ── 5 · COMPLETAR el modificador obligatorio ─────────────────────────
      case 'completarModificador': {
        const est = await estadoModificador()
        // Antes este paso sólo comprobaba que la compuerta EXISTIERA: el guion
        // traía `elegir: null` y nunca escogía la opción, así que el paso
        // «completar modificador» no completaba nada.
        let r
        if (!est.exigido) {
          r = { ok: false, motivo: `el grupo «${objetivo.grupo}» no exigió elección`, enPantalla: est.enPantalla }
        } else {
          const opcion = await pulsar(escapar(objetivo.opcion), `opción ${objetivo.opcion}`)
          await page.waitForTimeout(900)
          if (opcion.ok === false) {
            r = opcion
          } else {
            const confirmar = await pulsar('^Agregar \\$', 'confirmar producto')
            await page.waitForTimeout(2000)
            // La ley: al completar el grupo, el botón deja de decir «Elige …» y
            // pasa a «Agregar $…». Si sigue diciendo «Elige», no se completó.
            r = confirmar.ok === false
              ? { ...confirmar, motivo: `${confirmar.motivo} — el botón siguió exigiendo el grupo` }
              : confirmar
          }
        }
        await registrar(paso, r, { compuerta: { exigido: est.exigido, rotulo: est.rotulo, deshabilitado: est.deshabilitado } })
        break
      }

      // ── 6 · Enviar a cocina ──────────────────────────────────────────────
      case 'enviar': {
        const r = await pulsar('^Enviar$', 'enviar a cocina')
        await page.waitForTimeout(4500); await ingresarConPin(); await page.waitForTimeout(1500)
        await registrar(paso, r)
        break
      }

      default:
        pasos.push({ n: paso.n, accion: paso.accion, etiqueta: paso.etiqueta, ok: false,
          motivo: `acción desconocida «${paso.accion}»`, causa: 'arnes', evidencia: null })
    }
    await recoger()
  }

  await detenerTraza()

  // ── UN GUION QUE NO SE EJECUTÓ NO ES UN GUION IDÉNTICO ───────────────────
  //
  // Primera corrida real de G01: los seis clics fallaron, el manifiesto quedó
  // casi vacío, y el comparador informó «ZERO DELTA» — porque comparar dos
  // corridas vacías da cero trivialmente. Un arnés que dice «idénticos» cuando
  // no pasó nada es peor que no tener arnés: da permiso de avanzar.
  const pasosOk = pasos.filter(p => p.ok).length
  const corrio = pasos.length === guion.pasos.length && pasosOk === guion.pasos.length
  if (!corrio) {
    const ultimo = pasos.find(p => !p.ok)
    manifiesto.__no_corrio = {
      pasosFallidos: pasos.filter(p => !p.ok).map(p => `${p.n}·${p.etiqueta}`),
      enPantallaAlFallar: ultimo?.enPantalla ?? [],
    }
  }

  // El estado final, leído de la pantalla — es lo que ve el mesero.
  const pantalla = await page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    return { ruta: location.pathname + location.search, importes: (t.match(/\$[\d,]+\.\d{2}/g) || []).slice(0, 8) }
  }).catch(() => ({}))
  manifiesto.order_state.push({ origen: 'pantalla', ...pantalla })

  await nav.close()
  return { manifiesto, bitacora, pasos, corrio, pasosOk, pasosTotal: guion.pasos.length, traza }
}

/** Reexportado para que el guion viva en un solo lugar: `cert/objetivo-g01.mjs`. */
export const G01 = GUION_G01

/** Un nombre de producto puede traer `$`, `(` o `+`: no son metacaracteres aquí. */
function escapar(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
