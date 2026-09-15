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
import { vacio } from './manifiesto-de-efectos.mjs'

const PIN = process.env.FULLSITE_PIN || '1234'

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

    if (esEscritura && (url.includes('/api/') || esPedro)) {
      let cuerpo = null
      try { cuerpo = opciones.body ? JSON.parse(opciones.body) : null } catch { cuerpo = '(no es JSON)' }
      anotar(esPedro ? 'pedro_events' : 'api_writes', { metodo, url: url.replace(/^https?:\/\/[^/]+/, ''), cuerpo })
      // NO SALE. Se contesta con algo verosímil para que el flujo siga.
      return new Response(JSON.stringify({ ok: true, capturado: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return fetchReal(entrada, opciones)
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

export async function conducirV1(guion, { mesa = 7 } = {}) {
  const nav = await chromium.connectOverCDP(process.env.FULLSITE_CDP || 'http://127.0.0.1:9222')
  const ctx = nav.contexts()[0]
  await ctx.addInitScript(SONDA)

  const page = ctx.pages().find(p => p.url().includes('/pos')) || ctx.pages()[0]
  const manifiesto = vacio()
  const bitacora = []

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

  const desbloquear = async () => {
    const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')).catch(() => '')
    if (!/PIN para abrir|Huella digital o PIN|Ingresa tu PIN/i.test(t)) return
    for (const d of PIN.split('')) {
      await page.getByRole('button', { name: new RegExp(`^${d}$`) }).first().click().catch(() => {})
      await page.waitForTimeout(130)
    }
    // El confirmar es un icono sin texto: se busca por nombre accesible, y sólo
    // está habilitado con el PIN completo.
    await pulsar('^Entrar$', 'confirmar PIN')
    await page.waitForTimeout(3500)
  }

  const recoger = async () => {
    const efs = await page.evaluate(() => { const e = window.__efectos || []; window.__efectos = []; return e })
      .catch(() => [])
    for (const e of efs) (manifiesto[e.categoria] ||= []).push(e.dato)
  }

  // ── El guion, paso a paso ────────────────────────────────────────────────
  for (const paso of guion.pasos) {
    switch (paso.accion) {
      case 'abrirMesa':
        await page.goto('https://app.fullsite.mx/pos/mesas', { waitUntil: 'domcontentloaded', timeout: 45000 })
        await page.waitForTimeout(4000); await desbloquear(); await page.waitForTimeout(2200)
        await pulsar(`^${paso.mesa ?? mesa}\\s+(Disponible|Ocupada)`, `abrir mesa ${paso.mesa ?? mesa}`)
        await page.waitForTimeout(3500); await desbloquear(); await page.waitForTimeout(2000)
        break

      case 'agregarProducto':
        await pulsar(`^${paso.categoria}`, `categoría ${paso.categoria}`)
        await page.waitForTimeout(1800)
        await pulsar(paso.producto, `producto ${paso.producto}`)
        await page.waitForTimeout(2200)
        break

      case 'exigirModificadorObligatorio': {
        // La ley: con un grupo obligatorio, el botón de confirmar se RENOMBRA a
        // «Elige <GRUPO>» y queda deshabilitado. Que el POS lo impida es la
        // funcionalidad; comprobarlo es el paso.
        const est = await page.evaluate(() => {
          const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
          const bs = [...document.querySelectorAll('button')].filter(vis)
          const elige = bs.find(b => /^Elige\s+/i.test((b.innerText || '').trim()))
          const agregar = bs.find(b => /^Agregar\s+\$/i.test((b.innerText || '').trim()))
          return {
            exigido: !!elige,
            rotulo: (elige || agregar)?.innerText?.trim() || null,
            deshabilitado: !!(elige && (elige.disabled || elige.getAttribute('aria-disabled') === 'true')),
          }
        })
        bitacora.push({ etiqueta: 'modificador obligatorio', ...est })
        if (est.exigido && paso.elegir) {
          await pulsar(paso.elegir, `opción ${paso.elegir}`)
          await page.waitForTimeout(900)
        }
        await pulsar('^(Agregar \\$|Elige )', 'confirmar producto')
        await page.waitForTimeout(2000)
        break
      }

      case 'enviar':
        await pulsar('^Enviar$', 'enviar a cocina')
        await page.waitForTimeout(4500); await desbloquear(); await page.waitForTimeout(1500)
        break
    }
    await recoger()
  }

  // ── UN GUION QUE NO SE EJECUTÓ NO ES UN GUION IDÉNTICO ───────────────────
  //
  // Primera corrida real de G01: los seis clics fallaron, el manifiesto quedó
  // casi vacío, y el comparador informó «ZERO DELTA» — porque comparar dos
  // corridas vacías da cero trivialmente. Un arnés que dice «idénticos» cuando
  // no pasó nada es peor que no tener arnés: da permiso de avanzar.
  //
  // Por eso el conductor declara si el guion CORRIÓ, y quien lo use tiene que
  // mirar eso ANTES que el veredicto de paridad.
  const fallos = bitacora.filter(b => b.ok === false)
  const corrio = fallos.length === 0
  if (!corrio) {
    const ultima = fallos[fallos.length - 1]
    manifiesto.__no_corrio = {
      pasosFallidos: fallos.map(f => f.etiqueta),
      enPantallaAlFallar: ultima?.enPantalla?.slice(0, 12) ?? [],
    }
  }

  // El estado final, leído de la pantalla — es lo que ve el mesero.
  const pantalla = await page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    return { ruta: location.pathname + location.search, importes: (t.match(/\$[\d,]+\.\d{2}/g) || []).slice(0, 8) }
  }).catch(() => ({}))
  manifiesto.order_state.push({ origen: 'pantalla', ...pantalla })

  await nav.close()
  return { manifiesto, bitacora, corrio }
}

export const G01 = {
  nombre: 'abrir mesa → agregar producto → modificador obligatorio → enviar',
  pasos: [
    { accion: 'abrirMesa', mesa: 7 },
    { accion: 'agregarProducto', categoria: 'Appetizers', producto: 'HUMMUS' },
    { accion: 'exigirModificadorObligatorio', elegir: null },
    { accion: 'enviar' },
  ],
}
