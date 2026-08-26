// Regresión — el detector de skimming de /api/pos/save-order tiene que restar el IVA.
//
// Qué estaba roto (hasta 2026-08-26):
//
//   const expectedTotal = sumItems - cents(body.descuento ?? 0)   // ← SIN IVA
//   const declaredTotal = cents(body.total ?? 0)                  // ← CON IVA
//   if (Math.abs(expectedTotal - declaredTotal) > 100) { auditar }
//
// El total que arma el POS es `subtotal_tras_descuento * (1 + iva_rate)`
// (pos/page.tsx:2889). Comparar la suma de items sin IVA contra ese total con IVA
// dispara SIEMPRE en cualquier restaurante con iva_rate > 0 — 5 de los 8 tenants,
// AMALAY incluido (iva_rate = 0.16 en la tabla clients).
//
// Medido en producción el 2026-08-26: los 15 eventos skimming_suspect que había en
// pos_audit_log eran todos el mismo falso positivo, y la aritmética lo delata:
//
//   1888.00 → 2190.08   (×1.16 exacto)
//   1169.00 → 1356.04   (×1.16 exacto)
//    630.00 →  730.80   (×1.16 exacto)
//
// Importa porque el agente anti-fraude consume estos eventos y los reporta POR MESERO.
// Un detector que dispara en cada ticket no es conservador: es ruido que tapa el caso
// real, y acusa a todo el personal.
//
// Las propiedades que fija este archivo:
//   1. Un ticket honesto con IVA NO se audita.
//   2. Un skimming real SÍ se audita, con el faltante bien calculado.
//   3. La tasa se resuelve del SERVIDOR — mandarla falsa en el body no calla al detector.
//   4. Sin tasa resoluble no se audita (preferimos no reportar a reportar de más).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'

type Llamada = { url: string; method: string; body: unknown }
let llamadas: Llamada[] = []

/** Tasa que devuelve la tabla `clients`. `null` = fila sin iva_rate; `vacio` = sin fila. */
let tasaEnBd: string | number | null | 'vacio' = '0.16'

function instalarFetch() {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    llamadas.push({
      url: u,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (u.includes('/rest/v1/clients')) {
      const filas = tasaEnBd === 'vacio' ? [] : [{ iva_rate: tasaEnBd }]
      return { ok: true, status: 200, json: async () => filas } as unknown as Response
    }
    // El RPC devuelve ok:false para que la ruta corte justo después de guardar:
    // lo que se prueba aquí es el bloque de detección, que corre antes.
    if (u.includes('/rest/v1/rpc/')) {
      return { ok: true, status: 200, json: async () => ({ ok: false }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  })
}

let tenant = 'amalay'
vi.mock('@/lib/api-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/api-auth')>()
  return {
    ...real,
    withPOSAuth: async () => ({
      clientId: tenant, staffId: 's1', staffName: 'Mesero', role: 'mesero', authType: 'session',
    }),
  }
})

/** Auditorías de skimming que se dispararon. */
const auditorias = () =>
  llamadas.filter(c => c.url.includes('/rest/v1/pos_audit_log') && c.method === 'POST')
    .map(c => c.body as { action: string; details: Record<string, number> })
    .filter(b => b.action === 'skimming_suspect')

type Item = { subtotal: number; cancelled?: boolean }
function pedido(opts: { items: Item[]; total: number; descuento?: number; extra?: Record<string, unknown> }) {
  return {
    order_id: 'ord-1',
    expected_revision: 1,
    status: 'cerrada',
    mesero: 'Mesero',
    items: opts.items,
    total: opts.total,
    descuento: opts.descuento ?? 0,
    ...opts.extra,
  }
}

async function guardar(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/pos/save-order/route')
  return POST({ json: async () => body } as unknown as import('next/server').NextRequest)
}

beforeEach(() => {
  vi.resetModules()   // limpia el cache de tasa por instancia entre pruebas
  vi.clearAllMocks()
  llamadas = []
  tenant = 'amalay'
  tasaEnBd = '0.16'
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  instalarFetch()
})

describe('detección de skimming — el IVA no es un faltante', () => {
  it('EL BUG: ticket honesto de AMALAY (1888 → 2190.08) NO se audita', async () => {
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 2190.08 }))

    expect(auditorias()).toHaveLength(0)
  })

  it('los tres tickets reales que ensuciaron pos_audit_log dejan de dispararse', async () => {
    const reales = [
      { items: 1888, total: 2190.08 },
      { items: 1169, total: 1356.04 },
      { items: 630, total: 730.80 },
    ]
    for (const t of reales) {
      llamadas = []
      vi.resetModules()
      await guardar(pedido({ items: [{ subtotal: t.items }], total: t.total }))
      expect(auditorias(), `items ${t.items} → total ${t.total}`).toHaveLength(0)
    }
  })

  it('un skimming real SÍ se audita, con el faltante bien calculado', async () => {
    // Items por 1888 con IVA = 2190.08. El mesero declara 1500 y se embolsa 690.08.
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 1500 }))

    const evs = auditorias()
    expect(evs).toHaveLength(1)
    expect(evs[0].details.diff_cents).toBe(219008 - 150000)
    expect(evs[0].details.expected_total_cents).toBe(219008)
    expect(evs[0].details.iva_rate).toBe(0.16)
  })

  it('la tasa se resuelve del SERVIDOR: mandarla falsa en el body no calla al detector', async () => {
    // Si la tasa se leyera del cliente, bastaría con mandar iva_rate:0 para que
    // 1888 pareciera el total correcto y el faltante quedara escondido.
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 1888, extra: { iva_rate: 0 } }))

    expect(auditorias()).toHaveLength(1)
  })

  it('un total MAYOR al esperado no es skimming', async () => {
    // Antes disparaba por el Math.abs, duplicando la superficie de falsos positivos.
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 3000 }))

    expect(auditorias()).toHaveLength(0)
  })

  it('respeta el descuento antes de aplicar el IVA', async () => {
    // (1000 − 100) × 1.16 = 1044
    await guardar(pedido({ items: [{ subtotal: 1000 }], total: 1044, descuento: 100 }))

    expect(auditorias()).toHaveLength(0)
  })

  it('ignora los items cancelados', async () => {
    await guardar(pedido({
      items: [{ subtotal: 1888 }, { subtotal: 500, cancelled: true }],
      total: 2190.08,
    }))

    expect(auditorias()).toHaveLength(0)
  })

  it('un restaurante sin IVA sigue detectando el faltante', async () => {
    tenant = 'boruca'
    tasaEnBd = '0'
    await guardar(pedido({ items: [{ subtotal: 1000 }], total: 800 }))

    const evs = auditorias()
    expect(evs).toHaveLength(1)
    expect(evs[0].details.diff_cents).toBe(20000)
  })

  it('un restaurante sin IVA no audita el ticket honesto', async () => {
    tenant = 'boruca'
    tasaEnBd = '0'
    await guardar(pedido({ items: [{ subtotal: 1000 }], total: 1000 }))

    expect(auditorias()).toHaveLength(0)
  })

  it('sin tasa resoluble no se audita — no reportar de más', async () => {
    tasaEnBd = 'vacio'
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 1 }))

    expect(auditorias()).toHaveLength(0)
  })

  it('una tasa basura en BD se descarta en vez de generar ruido', async () => {
    tasaEnBd = 'no-es-un-numero'
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 1 }))

    expect(auditorias()).toHaveLength(0)
  })

  it('la tasa se consulta una sola vez por tenant, no en cada cierre', async () => {
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 2190.08 }))
    await guardar(pedido({ items: [{ subtotal: 1169 }], total: 1356.04 }))

    const consultas = llamadas.filter(c => c.url.includes('/rest/v1/clients'))
    expect(consultas).toHaveLength(1)
  })

  it('una cuenta abierta no se evalúa', async () => {
    await guardar(pedido({ items: [{ subtotal: 1888 }], total: 1, extra: { status: 'abierta' } }))

    expect(auditorias()).toHaveLength(0)
    expect(llamadas.filter(c => c.url.includes('/rest/v1/clients'))).toHaveLength(0)
  })
})
