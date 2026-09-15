// LA SONDA — el único punto por donde el POS puede tocar el mundo.
//
// Vive en su propio módulo por una razón concreta: es la pieza de la que depende
// la garantía de CERO ESCRITURAS, y su prueba (`cert/probar-captura-cero.mjs`)
// no debe arrastrar `playwright` para correr. Una garantía de seguridad que sólo
// se puede comprobar con un navegador instalado se comprueba menos veces.
//
// Se inyecta con `addInitScript`, así que NO puede capturar nada del ámbito
// exterior: todo lo que usa está declarado adentro.

/* ═══════════════════════════════════════════════════════════════════════════
   LA SONDA — se inyecta ANTES de que cargue la página
   ───────────────────────────────────────────────────────────────────────────
   Envuelve los puntos por donde el POS toca el mundo. Se instala en
   `addInitScript` para que exista antes que el código de la aplicación: si se
   instalara después, los efectos del arranque se perderían y el manifiesto
   diría «no pasó nada» cuando sí pasó. Ése es el error que este arnés existe
   para no cometer.
   ═══════════════════════════════════════════════════════════════════════════ */
// Se exporta para que `cert/probar-captura-cero.mjs` la ejerza con un `window`
// falso: la garantía de CERO ESCRITURAS se prueba sobre ESTA función, no sobre
// una copia del criterio en la prueba. Un test que reimplementa la regla que
// vigila pasa cuando el código real ya cambió.
//
// Sigue siendo una función serializable para `addInitScript`: no captura nada
// del ámbito exterior, y el `export` no altera eso.
export const SONDA = (cfg) => {
  const efectos = []
  const anotar = (categoria, dato) => efectos.push({ categoria, dato, t: Date.now() })
  window.__efectos = efectos

  /* ═══════════════════════════════════════════════════════════════════════════
     EL MODO, Y EL GUARDIA QUE LO ACOMPAÑA
     ───────────────────────────────────────────────────────────────────────────
     CAPTURE_ONLY (default) es lo de siempre: nada sale. Sirve para medir
     intenciones y comparar dos corridas mil veces sin mover un peso.

     SANDBOX deja salir las escrituras, porque sin efectos reales no hay nada
     que un oráculo pueda observar: sin orden en la base no hay DB_ORACLE, sin
     evento entregado no hay PEDRO_ORACLE ni KDS_ORACLE.

     El precio de dejar salir es que ahora SÍ se puede romper algo. Por eso el
     guardia, y por eso FALLA CERRADO en todos los casos ambiguos:

       · sin tenant permitido declarado          → no sale nada
       · tenant permitido distinto del de lab    → no sale nada
       · el destino menciona un tenant prohibido → no sale, y se anota violación
       · el tenant del cuerpo ≠ el permitido     → no sale, y se anota violación
       · no se pudo determinar el tenant         → sólo sale por el proxy del
         producto, que impone el scope desde el shift token; contra Supabase
         REST directo no sale

     La última regla es la que importa: un POST a `/rest/v1/pos_orders` sin
     `client_id` legible no se deja salir aunque «probablemente» sea del lab.
     Probablemente no es una garantía.
     ═══════════════════════════════════════════════════════════════════════════ */
  const MODO = (cfg && cfg.modo) === 'SANDBOX' ? 'SANDBOX' : 'CAPTURE_ONLY'
  const TENANT_OK = (cfg && cfg.tenantPermitido) ? String(cfg.tenantPermitido).toLowerCase() : null
  const TENANT_UNICO = (cfg && cfg.tenantUnicoValido) ? String(cfg.tenantUnicoValido).toLowerCase() : 'fullsite-cert-lab-v2'
  const PROHIBIDOS = ((cfg && cfg.prohibidos) || ['amalay', 'demo', 'lab-resto']).map(s => String(s).toLowerCase())

  // El modo sólo es SANDBOX si el tenant permitido es EXACTAMENTE el del
  // laboratorio. Cualquier otra cosa degrada a CAPTURE_ONLY en vez de escribir.
  const MODO_EFECTIVO = (MODO === 'SANDBOX' && TENANT_OK === TENANT_UNICO) ? 'SANDBOX' : 'CAPTURE_ONLY'
  window.__sondaModo = { pedido: MODO, efectivo: MODO_EFECTIVO, tenantPermitido: TENANT_OK }

  /** Busca el tenant en el cuerpo y en la URL. `null` = no se pudo determinar. */
  function tenantDe(url, cuerpo) {
    const deCuerpo = (o) => {
      if (!o || typeof o !== 'object') return null
      const c = Array.isArray(o) ? o[0] : o
      if (!c || typeof c !== 'object') return null
      return c.client_id ?? c.clientId ?? c.restaurant_id ?? c.tenant ?? null
    }
    const t = deCuerpo(cuerpo)
    if (t) return String(t).toLowerCase()
    const m = String(url).match(/client_id=(?:eq\.)?([A-Za-z0-9_-]+)/)
    return m ? m[1].toLowerCase() : null
  }

  /** ¿Algún tenant prohibido aparece en el destino o en el cuerpo? */
  function mencionaProhibido(url, cuerpo) {
    let texto = String(url)
    try { texto += ' ' + JSON.stringify(cuerpo ?? '') } catch { /* cuerpo no serializable */ }
    const bajo = texto.toLowerCase()
    // Frontera de palabra: `demo` no debe disparar con `cert-lab-demoX`, pero
    // sí con `client_id=demo` o `/rest/v1/x?client_id=eq.demo`.
    return PROHIBIDOS.find(p => new RegExp(`(^|[^a-z0-9-])${p}([^a-z0-9-]|$)`).test(bajo)) || null
  }

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

      /* ── LA DECISIÓN: ¿sale o no sale? ──────────────────────────────────
         En CAPTURE_ONLY jamás sale. En SANDBOX sale sólo si el guardia lo
         autoriza, y toda negativa queda anotada con su motivo — una escritura
         bloqueada es un dato del acta, no un silencio. */
      if (MODO_EFECTIVO !== 'SANDBOX') {
        // NO SALE. Se contesta con algo verosímil para que el flujo siga.
        return new Response(JSON.stringify({ ok: true, capturado: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }

      const prohibido = mencionaProhibido(ruta, cuerpo)
      const tenant = tenantDe(ruta, cuerpo)
      let veredicto = null

      if (prohibido) {
        veredicto = `menciona el tenant prohibido «${prohibido}»`
      } else if (tenant && tenant !== TENANT_OK) {
        veredicto = `el tenant del destino es «${tenant}», no «${TENANT_OK}»`
      } else if (!tenant) {
        // Sin tenant legible: sólo se confía en el proxy del producto, que
        // impone el scope desde el shift token. Pedro entra aquí salvo que su
        // propia identidad se haya verificado afuera y coincida con el lab.
        const esProxyDelProducto = /^\/api\//.test(ruta) && !esPedro
        const puenteVerificado = esPedro &&
          cfg && String(cfg.bridgeTenant || '').toLowerCase() === TENANT_UNICO
        if (!esProxyDelProducto && !puenteVerificado) {
          veredicto = esPedro
            ? 'el puente local no acreditó pertenecer al tenant de laboratorio'
            : 'no se pudo determinar el tenant y el destino no es el proxy del producto'
        }
      }

      if (veredicto) {
        anotar('sandbox_violations', { metodo, url: ruta, motivo: veredicto, tenant, prohibido })
        return new Response(JSON.stringify({ ok: false, bloqueado_por_el_guardia: veredicto }), {
          status: 403, headers: { 'content-type': 'application/json' },
        })
      }

      anotar('sandbox_writes', { metodo, url: ruta, tenant: tenant ?? '(del token)' })
      return fetchReal(entrada, opciones)   // SALE DE VERDAD
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
