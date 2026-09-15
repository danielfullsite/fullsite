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
import { SONDA } from './sonda.mjs'
import { OBJETIVO, ENTORNO, G01 as GUION_G01 } from './cert/objetivo-g01.mjs'

// El PIN no tiene default. Un PIN adivinado produce un fallo de autenticación
// que se lee como defecto del producto — el error que ya costó dos corridas.
// Sin PIN, la compuerta G-8 del preflight detiene la corrida antes de empezar.
const PIN = process.env.FULLSITE_PIN || ''

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
    // ── EL MODO DE LA SONDA ────────────────────────────────────────────────
    // CAPTURE_ONLY por defecto, siempre. Escribir de verdad tiene que pedirse
    // explícitamente y acreditar a qué tenant: el default nunca arriesga.
    modo            = 'CAPTURE_ONLY',
    tenantPermitido = null,     // en SANDBOX, el único tenant al que se deja escribir
    bridgeTenant    = null,     // tenant que el puente local acreditó (verificado en L0)
  } = opciones

  const nav = await chromium.connectOverCDP(cdp)
  const ctx = nav.contexts()[0]
  // La configuración viaja como ARGUMENTO, no capturada del ámbito: `addInitScript`
  // serializa la función y un `const` de aquí afuera llegaría como `undefined`.
  await ctx.addInitScript(SONDA, { modo, tenantPermitido, bridgeTenant })

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

  /**
   * Pulsa la tarjeta de una mesa POR SU IDENTIDAD, nunca por su estado.
   *
   * El patrón anterior era `^<n>\s+(Disponible|Ocupada)`, y eso metía el estado
   * dentro de la identidad del control. La mesa 1 existía, estaba visible y era
   * pulsable, pero decía «Sin confirmar» —un tercer estado que el producto lista
   * en su propia leyenda— y el conductor informó «no está en pantalla». Enumerar
   * estados sólo mueve el problema al siguiente estado que alguien agregue.
   *
   * Una mesa se identifica por su NÚMERO. El estado se observa aparte y viaja a
   * la evidencia (`estadoMesa`), que es donde sirve.
   *
   * Orden de búsqueda, del identificador más estable al más frágil:
   *   1. `data-testid` semántico (`mesa-3`, `table-3`) — hoy el POS no lo pone,
   *      pero cuando lo ponga esto lo usa sin tocar nada más.
   *   2. `aria-label` que nombre la mesa.
   *   3. control cuyo texto EMPIECE por el número, ignorando lo que siga.
   *
   * Y distingue tres desenlaces que no son lo mismo: no hay ninguna mesa
   * (precondición: el tenant no las sembró), la mesa está pero deshabilitada
   * (dato del producto), o la mesa está y se pudo pulsar.
   */
  const pulsarMesa = async (n) => {
    const r = await page.evaluate((num) => {
      const vis = (el) => {
        const b = el.getBoundingClientRect()
        return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== 'none'
      }
      const controles = [...document.querySelectorAll('button,[role=button]')].filter(vis)
      const texto = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim()

      // 1 · identificador semántico
      let b = controles.find(el => {
        const id = el.getAttribute('data-testid') || el.dataset?.mesa || el.dataset?.table || ''
        return new RegExp(`^(mesa|table)[-_]?${num}$`, 'i').test(String(id))
      })
      let via = b ? 'data-testid' : null

      // 2 · nombre accesible
      if (!b) {
        b = controles.find(el => new RegExp(`\\bmesa\\s*${num}\\b`, 'i').test(el.getAttribute('aria-label') || ''))
        if (b) via = 'aria-label'
      }

      // 3 · el número al principio del rótulo, pase lo que pase después.
      //     Se exige algo MÁS que el número para no confundir la tarjeta con la
      //     tecla «1» del teclado numérico del PIN, cuyo texto es sólo el dígito.
      if (!b) {
        b = controles.find(el => {
          const t = texto(el)
          return new RegExp(`^${num}\\b`).test(t) && t.length > String(num).length
        })
        if (b) via = 'texto que empieza por el número'
      }

      const inventario = () => controles.map(x => texto(x) || x.getAttribute('aria-label') || '(sin nombre)').slice(0, 30)

      if (!b) {
        // ¿Hay ALGUNA tarjeta de mesa? Distingue «el tenant no sembró mesas»
        // de «hay mesas y no reconocí ésta».
        const hayMesas = controles.some(el => /^\d+\b/.test(texto(el)) && texto(el).length > 1)
        return { ok: false, motivo: hayMesas ? `la mesa ${num} no está entre las mesas visibles`
                                             : 'no hay ninguna mesa en pantalla',
                 hayMesas, enPantalla: inventario() }
      }

      const rotulo = texto(b)
      // El estado es lo que queda del rótulo al quitarle número y aforo.
      const estadoMesa = (rotulo.replace(new RegExp(`^${num}\\s*`), '')
        .replace(/\d+\s*lug\.?/i, '').trim()) || null

      if (b.disabled || b.getAttribute('aria-disabled') === 'true') {
        return { ok: false, motivo: 'está deshabilitado', rotulo, estadoMesa, enPantalla: inventario() }
      }
      b.click()
      return { ok: true, rotulo, estadoMesa, via }
    }, n)
    bitacora.push({ etiqueta: `abrir mesa ${n}`, ...r })
    return r
  }

  /**
   * Pulsa una OPCIÓN de modificador. No todo lo que se toca es un `<button>`.
   *
   * `pulsar()` busca en `button,[role=button]`, y con eso llega a categorías,
   * productos y botones de acción. Las opciones de un grupo NO son botones:
   * `pos/page.tsx:527` las dibuja como `<label>` con un `<input type=checkbox>`
   * en `sr-only` — accesible y correcto, pero invisible para aquel selector.
   *
   * Resultado medido en cert-g01-20260915T205037Z: el modal estaba abierto, con
   * «Obligatorio», «Max 1» y el botón bloqueado en «Elige CERT-G01-OPCION» —el
   * producto haciendo exactamente lo que debe— y el conductor informó que
   * CERT-G01-ESTANDAR «no está en pantalla».
   *
   * Se pulsa el `<label>`, no el input oculto: es lo que toca un mesero, y es
   * lo que dispara el `onChange` del producto.
   */
  const pulsarOpcion = async (texto, etiqueta = texto) => {
    const r = await page.evaluate((t) => {
      const vis = (el) => {
        const b = el.getBoundingClientRect()
        return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== 'none'
      }
      const re = new RegExp(t, 'i')
      const candidatos = [...document.querySelectorAll(
        'label,[role=option],[role=radio],[role=checkbox],[role=menuitemradio],button,[role=button]')].filter(vis)
      const nombre = (el) => (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim()

      const el = candidatos.find(x => re.test(nombre(x)))
      if (!el) {
        return { ok: false, motivo: 'no está en pantalla',
                 enPantalla: candidatos.map(nombre).filter(Boolean).slice(0, 25) }
      }
      const rotulo = nombre(el)
      const dentro = el.querySelector('input,[role=radio],[role=checkbox]')
      const bloqueado = el.getAttribute('aria-disabled') === 'true' || el.disabled === true ||
                        (dentro && dentro.disabled === true)
      if (bloqueado) {
        // El control EXISTE y el producto lo bloquea: eso es dato del producto,
        // no ceguera del instrumento.
        return { ok: false, motivo: 'está deshabilitado', rotulo, controlPresente: true }
      }
      el.click()
      const marcado = dentro ? (dentro.checked === true || dentro.getAttribute('aria-checked') === 'true') : null
      return { ok: true, rotulo, marcado, etiquetaHTML: el.tagName.toLowerCase() }
    }, texto)
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
  /**
   * ¿A quién se le imputa que un paso no se ejecutara?
   *
   * La causa por defecto la fija el guion (`causaSiFalta`): un dato que el
   * tenant debía sembrar es precondición. Pero esa regla se equivoca en un caso
   * concreto y ya se equivocó: la mesa 1 ESTABA en pantalla, visible y
   * pulsable, y el conductor la reportó ausente porque su patrón exigía un
   * estado que no era el de esa mesa. Eso se clasificó como precondición del
   * tenant cuando era del instrumento.
   *
   * La regla: si el DOM demuestra que el control existía, la culpa es del
   * arnés — da igual qué diga el guion. Un instrumento que no reconoce lo que
   * tiene enfrente no puede cobrárselo al sistema que mide.
   */
  const imputar = (paso, r) => {
    if (r.controlPresente === true) return 'arnes'
    if (r.hayMesas === true) return 'arnes'          // había mesas; no supo cuál
    if (r.motivo === 'está deshabilitado') return 'producto'  // existe y el producto lo bloquea
    return paso.causaSiFalta ?? 'arnes'
  }

  const registrar = async (paso, r, extra = {}) => {
    const png = await retratar(paso.n, paso.accion)
    pasos.push({
      n: paso.n, accion: paso.accion, etiqueta: paso.etiqueta,
      ok: r.ok !== false,
      motivo: r.ok === false ? (r.motivo ?? 'no se ejecutó') : null,
      causa: r.ok === false ? imputar(paso, r) : null,
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
        const r = await pulsarMesa(n)
        await page.waitForTimeout(3500); await ingresarConPin(); await page.waitForTimeout(2000)
        await registrar(paso, r)
        // El estado de la mesa es una de las diez categorías del manifiesto y
        // estaba muerta: se lee de la pantalla, que es lo que ve el mesero.
        // Va aquí, en la EVIDENCIA, y no en el selector: ver §pulsarMesa.
        const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')).catch(() => '')
        manifiesto.table_state.push({ mesa: n, abierta: r.ok === true, estado: r.estadoMesa ?? null,
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
          const opcion = await pulsarOpcion(escapar(objetivo.opcion), `opción ${objetivo.opcion}`)
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
  // El modo que la sonda REALMENTE aplicó, leído de la página. Pedirlo no es lo
  // mismo que obtenerlo: la sonda degrada a CAPTURE_ONLY cuando el tenant no
  // acredita, y quien lea el acta tiene que ver cuál de los dos ocurrió.
  const modoEfectivo = await page.evaluate(() => window.__sondaModo ?? null).catch(() => null)

  // Las capturas que existen, contadas sobre el disco y no sobre la intención:
  // un `screenshot()` que falló en silencio dejaría el contador en alto y el
  // directorio vacío, que es exactamente la evidencia que no se puede auditar.
  const capturas = pasos.map(p => p.evidencia).filter(Boolean)

  return { manifiesto, bitacora, pasos, corrio, pasosOk, pasosTotal: guion.pasos.length,
           traza, capturas, modoEfectivo }
}

/** Reexportado para que el guion viva en un solo lugar: `cert/objetivo-g01.mjs`. */
export const G01 = GUION_G01

/** Un nombre de producto puede traer `$`, `(` o `+`: no son metacaracteres aquí. */
function escapar(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
