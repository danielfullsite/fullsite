import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { leerConfigDayparts, preguntaDeFranjas, ventasPorFranja, contextoFranjas } from '@/lib/dayparts'
import { crearRpc, intencion, leerFrescura, textoFrescura, contextoProducto, contextoReceta, contextoInsumo } from '@/lib/chat-nativo'
import { buildDailyFromOrders, buildDailyConEstado } from '@/lib/pos-daily'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { esDuenoDelHistoricoWansoft } from '@/lib/wansoft-legacy'
import { requireTenant } from '@/lib/api-auth'
import { sumarDias } from '@/lib/date-mx'
import {
  claveReceta, contextoAlertas, contextoFuentesFallidas, compararHoyMismaHora, datoTexto, envolverDatos,
  fechaLargaEnZona, historialSeguro, horaEnZona, preguntaDeAlertas, pronosticoMismoDia, resumenesPrecalculados,
  ventasPorHoraDesdeAcumulados, ventasPorMes, DIAS_PARA_DATO_VIEJO, diasEntre, zonaDelTenant, ETIQUETAS_NO_MESERO,
  diasParaCubrirMesAnterior, ZONA_POR_DEFECTO,
} from '@/lib/chat-context'
import { contextoDia, type ContextoDia } from '@/lib/agents/dia-negocio'
import { desdeEventos, type EventoAgente } from '@/lib/atencion'
import { esModoVoz, instruccionModoVoz } from '@/lib/voz/instruccion-voz'
import {
  aplicarGraficas, anexarGrafica, claveConsulta, compactarGraficasEnHistorial, construirCatalogo, elegirGraficaPorPregunta,
  graficaDeConsulta, lineasCatalogoParaPrompt, MAX_GRAFICAS_POR_RESPUESTA, type FuenteVentasChat,
} from '@/lib/graficas-chat'
import type { FilaFranja, DaypartsConfig } from '@/lib/dayparts'
import type { GraficaSpec } from '@/lib/grafica-spec'
import {
  bloqueMapa, credencialesLectura, datosHastaDeTablas, ejecutarConsulta, leerMapa, pistasDelMapa, responderConHerramientas,
  mensajesDeRespaldo, MAX_CONSULTAS, type ConsultaHecha, type ResultadoCiclo,
} from '@/lib/ia-lectura'
import { Evidencia, garantizarNumeros, mensajeReparacion } from '@/lib/verificador-numeros'
import { marcoRazonamientoOperativo } from '@/lib/chat-operating-intent'

// Ciclo de consultas (hasta ~20 s) + lecturas: más que el default de algunas cuentas.
export const maxDuration = 60

/**
 * Alias "nombre en el POS → nombre en el costeo" por tenant. Son datos del menú de un
 * restaurante (sus typos), no reglas del chat: se aplican SÓLO a ese tenant.
 * TODO: moverlos a una tabla por tenant cuando exista.
 */
const ALIAS_RECETAS_POR_TENANT: Record<string, Record<string, string>> = {
  amalay: {
    'EGG AND PANCAKE COMBO': 'EGG & PANCAKE COMBO',
    'SALMON BAGEL': 'BAGEL DE SALMON CURADO',
    'GARDEN OMELET': 'GARDEN OMELLET',
    "MUMMA'S BREAKFAST CROSSAINT": "MUMMA'S BREKFAST CROISSANT",
    'RIBEYE SMASH BURGER': 'SMASH BURGUER',
    'MISS BENEDICT KETO-PANELA WALLANDER': 'MISS KETO PANELA WALLANDER',
    'PIZZA PEPERONI': 'PIZZA PEPPERONI',
    'TURKEY  SWISS CROISSANT': 'TURKEY & SWISS',
    'PASTA BOLOGESE': 'PASTA BOLOGNESA',
    'ACAI LOVE BOWL': 'ACAI LOVE',
    'ACAI B KIND BOWL': 'ACAI B KIND',
    'BLUEBERRY CHEESECAKE': 'BLUEBERRY´S CHEESECAKE',
    'MINI TOAST TOWER': 'TORRE DE MINI TOAST',
    'CROQUE MONSIEUR': 'CROQUE MONSIUR',
    'TURKEY PANINI': 'TURKEY PANNINI',
    'COMBO GRILLED CHEESE  SAND. + TOMATO BASIL SOUP': 'COMBO GRILLED CHEESE SANDWICH + TOMATOE BASIL SOUP',
    'PROSCIUTTO  CHESSE PANINI': 'PROSCIUTTO & CHESSE PANNINI',
    'PIZZA PROSCIUTO': 'PIZZA DE PROCCIUTO',
    'PARADISE BUTTERMILK BLUEBERRY PANCAKES': 'BLUEBERRY PANCAKES',
    'BENEDICT OMELET': 'CLASSIC BENEDICT OMELLET',
  },
}

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignore - can't set cookies from route handler in some cases
          }
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Sesión vía cookie fs-at (login del dashboard) o header Authorization.
// Devuelve el user id si el token es válido, null si no hay sesión.
async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = request.cookies.get('fs-at')?.value || bearer
  if (!token) {
    // Fallback: cookies sb-* de @supabase/ssr (si algún cliente las usa)
    const user = await getAuthUser()
    return user?.id || null
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id || null
  } catch {
    return null
  }
}

// Simple rate limiting — max 20 requests per minute per user (30 en modo voz: una
// conversación manos libres hace turnos más cortos y seguidos; sigue siendo un freno)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
let lastCleanup = Date.now()

function checkRateLimit(userId: string, max = 20): boolean {
  const now = Date.now()
  // Cleanup expired entries every 5 minutes
  if (now - lastCleanup > 300000) {
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetTime) rateLimitMap.delete(key)
    }
    lastCleanup = now
  }
  const entry = rateLimitMap.get(userId)
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + 60000 })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

// Parse JSONB that might be double-encoded (string of string)
function parseJsonb(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val !== 'string') return []
  try {
    let parsed = JSON.parse(val)
    // Double-encoded: JSON.parse returns another string
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/** 'YYYY-MM-DD' menos n días (aritmética en UTC a mediodía: sin brincos de horario). */
function restarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], client_id: pedido, modo } = await request.json()
    // Modo voz ("Habla con tu restaurante"): misma ruta, mismos datos y guardias; sólo
    // cambia la FORMA de la respuesta (corta, sin markdown, números dichos).
    const enVoz = esModoVoz(modo)

    // FUGA F-2 CERRADA (2026-08-30): el auth solo comprobaba "hay sesión" y el
    // client_id salía del BODY sin validar membresía — cualquier usuario logueado
    // mandaba {client_id:"amalay"} y el chat le devolvía ventas, recetas, costos y
    // NOMBRES DEL STAFF de otro restaurante (el síntoma que Daniel vio). requireTenant
    // valida la membresía server-side y falla cerrado; el client_id de confianza es
    // auth.clientId, NUNCA el del body.
    const auth = await requireTenant(request, pedido)
    if (auth instanceof Response) return auth
    const client_id = auth.clientId
    const userId = auth.staffId
    // Lectura universal (ia_mapa / ia_consulta): con el JWT del usuario si la sesión es
    // de Supabase — así la consulta nunca ve más que él (RLS + timeouts de su rol). Con
    // token de turno del POS (no es JWT de Supabase) va la service key; las funciones
    // filtran igual por el client_id que decide ESTE servidor.
    const credLectura = credencialesLectura({
      sbUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      serviceKey: process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      authType: auth.authType,
      // Mismo orden que getSessionUserId (el token que se validó): cookie fs-at, luego Bearer.
      tokenUsuario: request.cookies.get('fs-at')?.value || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null,
    })

    // Rate limiting por usuario
    if (!checkRateLimit(userId, enVoz ? 30 : 20)) {
      return Response.json({ response: 'Demasiadas consultas. Espera un momento.' }, { status: 429 })
    }

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'Mensaje requerido' }, { status: 400 })
    }

    // Load client config for AI persona
    const { fetchClientConfig } = await import('@/lib/client-config')
    const clientConfig = await fetchClientConfig(client_id || '')
    const restaurantName = clientConfig.display_name || client_id || 'el restaurante'
    const restaurantCity = clientConfig.city || ''
    const restaurantContext = clientConfig.business_context || ''

    const supabase = createServiceClient()
    void supabase
    const q = message.toLowerCase()

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    // Service key (server-side only): sobrevive el endurecimiento RLS anon→authenticated
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }

    // ── DÍA DE VENTA DEL TENANT (antes de las lecturas: varias se filtran por fecha) ──
    //
    // "Hoy" es el DÍA DE VENTA, no el de calendario: zona del tenant + su hora de inicio
    // (`clients.business_day_start_local`, 05:00 por omisión) — la misma definición que
    // `pos_orders.dia_venta`. Con la fecha de calendario, a las 00:30 el chat buscaba el
    // día nuevo y decía "sin cobertura" mientras la noche seguía vendiendo.
    // La misma fila de `clients` trae los horarios de venta (dayparts): una sola lectura.
    const cfgDayparts = await leerConfigDayparts(sbUrl, sbKey, client_id || '')
    let dia: ContextoDia
    try {
      dia = contextoDia(Date.now(), zonaDelTenant({ timezone: cfgDayparts.timezone || clientConfig.timezone }), cfgDayparts.inicioDia)
    } catch {
      dia = contextoDia(Date.now(), ZONA_POR_DEFECTO, cfgDayparts.inicioDia) // zona inválida en la config
    }
    const zona = dia.tz
    const todayStr = dia.hoy
    // `sumarDias` opera sobre el calendario, no restando 86,400,000 ms: en una zona con
    // horario de verano un dia dura 23 o 25 horas dos veces al ano.
    const yesterday = sumarDias(todayStr, -1, zona)

    // Parse date ranges: "1 de mayo a 18 de mayo", "del 5 al 12 de mayo", "mayo", etc.
    const monthMap: Record<string, string> = {
      enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
      julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
    }
    let dateFilter: { start: string; end: string } | null = null

    // Try explicit date range: "1 de mayo a 18 de mayo" or "del 1 al 18 de mayo"
    const rangeMatch = q.match(/(\d{1,2})\s*(?:de\s+)?(\w+)\s*(?:a|al|hasta|a\s+el)\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)
    const rangeMatch2 = q.match(/del?\s*(\d{1,2})\s*al?\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)

    if (rangeMatch) {
      const [, d1, m1, d2, m2] = rangeMatch
      const mm1 = monthMap[m1.toLowerCase()]
      const mm2 = monthMap[m2.toLowerCase()]
      if (mm1 && mm2) {
        const year = todayStr.slice(0, 4)
        dateFilter = { start: `${year}-${mm1}-${d1.padStart(2, '0')}`, end: `${year}-${mm2}-${d2.padStart(2, '0')}` }
      }
    } else if (rangeMatch2) {
      const [, d1, d2, m] = rangeMatch2
      const mm = monthMap[m.toLowerCase()]
      if (mm) {
        const year = todayStr.slice(0, 4)
        dateFilter = { start: `${year}-${mm}-${d1.padStart(2, '0')}`, end: `${year}-${mm}-${d2.padStart(2, '0')}` }
      }
    }

    if (!dateFilter) {
      if (q.includes('ayer')) dateFilter = { start: yesterday, end: yesterday }
      else if (q.includes('hoy')) dateFilter = { start: todayStr, end: todayStr }
      else if (q.includes('semana')) {
        const weekAgo = sumarDias(todayStr, -7, zona)
        dateFilter = { start: weekAgo, end: todayStr }
      } else if (q.includes('mes')) {
        const monthStart = todayStr.slice(0, 8) + '01'
        dateFilter = { start: monthStart, end: todayStr }
      } else {
        // Check for single month name: "mayo", "abril"
        for (const [name, num] of Object.entries(monthMap)) {
          if (q.includes(name)) {
            const year = todayStr.slice(0, 4)
            const lastDay = new Date(Number(year), Number(num), 0).getDate()
            dateFilter = { start: `${year}-${num}-01`, end: `${year}-${num}-${String(lastDay).padStart(2, '0')}` }
            break
          }
        }
      }
    }

    // 1. Recent daily data — OPTIMIZED: 14 days default, 90 for history, 365 for year
    const wantsYear = ['año', 'anual', '2025', '2026', '12 meses', 'doce meses'].some(kw => q.includes(kw))
    const wantsHistory = wantsYear || ['historial', 'historia', 'abril', 'marzo', 'febrero', 'enero', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año', 'grafica', 'gráfica', 'chart', 'hace un', 'hace dos', 'hace tres', 'pronóstico', 'pronostico', 'mañana'].some(kw => q.includes(kw))
    const wantsDetail = true // Always load full detail
    // Siempre cubre el mes actual y el anterior completos (una sola consulta): con 14
    // días el resumen decía "MES ANTERIOR: sin cobertura" cuando sólo no se había leído.
    // El detalle diario que va al prompt se recorta abajo (DETALLE_DIAS).
    const histLimit = wantsYear ? 365 : wantsHistory ? 90 : Math.max(14, diasParaCubrirMesAnterior(todayStr))
    const selectCols = 'fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_metodos,platillos_top'

    // ── PARALLEL DATA LOADING ── All queries run at once to stay under Vercel 10s limit
    const wantsMeseros = ['mesero', 'quien', 'quién', 'ranking', 'top', 'mejor', 'peor', 'h&h', 'half', 'bebida', 'postre', 'pan', 'toast', 'propina', 'vendio', 'vendió', 'crack', 'manco', 'cuantos', 'cuántos', 'vendieron', 'vendimos'].some(kw => q.includes(kw))
    const wantsFoodCost = ['costo', 'cost', 'food cost', 'margen', 'insumo', 'ingrediente', 'receta', 'rentab', 'compra', 'comprado', 'precio', 'caro', 'barato', 'cuesta', 'kilo', 'gramo', 'lleva', 'platillo', 'proveedor', 'merma', 'porcion', 'porción'].some(kw => q.includes(kw))
    const wantsReservas = ['reserv', 'proxim', 'próxim', 'evento', 'fiesta', 'cumple', 'boda', 'terraza', 'jardin', 'jardín', 'paquete', 'pastel', 'invitados'].some(kw => q.includes(kw))
    const wantsOrders = ['orden', 'ordenes', 'órdenes', 'cancelacion', 'cancelación', 'cancelada', 'abierta', 'mesa ', 'ticket pos', 'cuantas mesas', 'cuántas mesas'].some(kw => q.includes(kw))
    const wantsMarket = ['market', 'inventario', 'stock', 'existencia', 'agotado', 'reorden', 'tienda', 'abarrote', 'producto market'].some(kw => q.includes(kw))
    const wantsAlertas = preguntaDeAlertas(q)
    const qSinAcentos = q.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const wantsHoyVsSemana = /\bhoy\b|como vamos|como van|vs la semana pasada|semana pasada/.test(qSinAcentos)

    // Se resuelve una sola vez antes del arreglo de fetches: adentro no cabe un await
    // sin volver perezoso todo el paralelismo, y este dato cambia una vez en la vida
    // del restaurante (además va cacheado 5 minutos).
    const duenoDelHistorico = wantsMeseros ? await esDuenoDelHistoricoWansoft(client_id) : false

    // UN FALLO NO ES UN DATO VACÍO. Antes cada lectura era `.then(r => r.ok ? r.json() : []).catch(() => [])`
    // y el contexto decía "No hay reservaciones" cuando la lectura había fallado. Ahora
    // `leer` devuelve null ante un fallo y anota la fuente en `fuentesFallidas`; el
    // prompt le dice al modelo "no pude leer <fuente>".
    const fuentesFallidas: string[] = []
    const leer = (url: string, fuente: string): Promise<Record<string, unknown>[] | null> =>
      fetch(url, { headers: sbHeaders, cache: 'no-store' })
        .then(async r => {
          if (!r.ok) { fuentesFallidas.push(fuente); return null }
          const j = await r.json()
          return Array.isArray(j) ? j as Record<string, unknown>[] : (fuentesFallidas.push(fuente), null)
        })
        .catch(() => { fuentesFallidas.push(fuente); return null })
    const nada = Promise.resolve([] as Record<string, unknown>[])

    // Órdenes (pregunta explícita): el periodo que pidió, o los últimos 7 días de venta.
    const ordDesde = dateFilter?.start || sumarDias(todayStr, -6, zona)
    const ordHasta = dateFilter?.end || todayStr
    const LIMITE_ORDENES = 500
    // Ranking de sucursales: 30 días, regla canónica de venta.
    const LIMITE_SUCURSALES = 3000
    const sucDesde = sumarDias(todayStr, -29, zona)
    const alertasDesde = new Date(Date.now() - 48 * 3600e3).toISOString()

    const fetches: Promise<Record<string, unknown>[] | null>[] = [
      // 0: Daily data (always)
      leer(`${sbUrl}/rest/v1/wansoft_daily?select=${selectCols}&client_slug=eq.${encodeURIComponent(client_id || '')}&ventas_dia=gt.0&order=fecha.desc&limit=${histLimit}`, 'histórico de ventas'),
      // 1: Waiter categories (conditional)
      // wansoft_waiter_categories no tiene columna de cliente; el guardián impide que
      // un restaurante vea los meseros de otro. Pregunta por la propiedad, no por el
      // nombre, y falla cerrado. Ver src/lib/wansoft-legacy.ts.
      (wantsMeseros && duenoDelHistorico) ? leer(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=7`, 'desglose de meseros') : nada,
      // 2: Food cost (conditional)
      wantsFoodCost ? leer(`${sbUrl}/rest/v1/wansoft_food_cost?client_id=eq.${encodeURIComponent(client_id)}&select=fecha,data&order=fecha.desc&limit=1`, 'mix de food cost') : nada,
      // 3: Reservaciones (conditional). `fecha >= hoy` con HOY EN LA ZONA DEL TENANT:
      //    con la fecha UTC, después de las 18:00 de Monterrey desaparecían las de hoy.
      wantsReservas ? leer(`${sbUrl}/rest/v1/reservaciones?client_id=eq.${encodeURIComponent(client_id || '')}&select=nombre,fecha,espacio,horario_inicio,guests,paquete,total,status,codigo_reserva&order=fecha.asc&fecha=gte.${todayStr}&limit=20`, 'reservaciones') : nada,
      // 4: POS orders (conditional) — SÓLO del periodo, por día de venta (antes: "las
      //    últimas 50 órdenes de cualquier fecha", que mezclaba días sin decirlo).
      wantsOrders ? leer(`${sbUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(client_id || '')}&dia_venta=gte.${ordDesde}&dia_venta=lte.${ordHasta}&select=status,total,mesa,mesero,metodo_pago,created_at,dia_venta&order=created_at.desc&limit=${LIMITE_ORDENES}`, 'órdenes del POS') : nada,
      // 5: Recipes + insumos (conditional — for food cost, receta, ingrediente questions)
      wantsFoodCost ? leer(`${sbUrl}/rest/v1/pos_recipes?select=nombre,precio_venta,costo_total,pct_costo,ingredientes&client_id=eq.${encodeURIComponent(client_id || '')}&order=nombre.asc&limit=120`, 'recetas') : nada,
      // 6: Insumos (conditional)
      wantsFoodCost ? leer(`${sbUrl}/rest/v1/pos_insumos?select=nombre,categoria,proveedor,um,precio_limpio,merma_pct&client_id=eq.${encodeURIComponent(client_id || '')}&order=nombre.asc&limit=500`, 'insumos') : nada,
      // 7: Sucursales del grupo (SIEMPRE). Son ~5 filas; sin esto el chat no sabe
      //    que el cliente tiene sucursales y responde "dime cuáles son".
      leer(`${sbUrl}/rest/v1/client_locations?client_id=eq.${encodeURIComponent(client_id || '')}&select=id,name&active=eq.true&order=name.asc&limit=100`, 'sucursales'),
      // 8: Órdenes con sucursal, para poder comparar entre ellas. Se piden sólo
      //    location_id y total: PostgREST no agrupa, la suma se hace abajo en JS.
      //    Regla ÚNICA de venta (= lib/data.ts, pos-daily y fs_es_venta): pagada, o
      //    cerrada sin payment_status. Antes era status=eq.cerrada a secas.
      leer(`${sbUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(client_id || '')}&select=location_id,total,created_at&or=(payment_status.eq.pagada,and(payment_status.is.null,status.eq.cerrada))&dia_venta=gte.${sucDesde}&order=created_at.desc&limit=${LIMITE_SUCURSALES}`, 'ventas por sucursal'),
      // 9: Market stock (conditional)
      wantsMarket ? leer(`${sbUrl}/rest/v1/pos_market_stock?select=menu_item_id,stock,reorder_point&client_id=eq.${encodeURIComponent(client_id || '')}&order=stock.asc&limit=100`, 'inventario market') : nada,
      // 10: Alertas abiertas de los agentes (misma tabla que /agentes), últimas 48 h.
      wantsAlertas ? leer(`${sbUrl}/rest/v1/agent_events?client_id=eq.${encodeURIComponent(client_id || '')}&created_at=gte.${encodeURIComponent(alertasDesde)}&select=id,severity,title,explanation,suggested_action,estimated_value,confidence,status,created_at,expires_at,type&order=created_at.desc&limit=40`, 'alertas de los agentes') : nada,
      // 11: Hoy vs mismo día de la semana pasada (a la misma hora): ventas de los dos días.
      wantsHoyVsSemana ? leer(`${sbUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(client_id || '')}&dia_venta=in.(${todayStr},${sumarDias(todayStr, -7, zona)})&or=(payment_status.eq.pagada,and(payment_status.is.null,status.eq.cerrada))&select=dia_venta,total,created_at&limit=${LIMITE_SUCURSALES}`, 'ventas de hoy y de la semana pasada') : nada,
    ]

    // La frescura del POS va en el MISMO lote paralelo (antes se esperaba sola, después).
    const rpc = crearRpc(sbUrl, sbKey)
    // El MAPA DE DATOS (ia_mapa) también va en este lote: no suma latencia.
    const [[recentDaysRaw, waiterRowsRaw, fcRowsRaw, reservasRaw, ordersRaw, recipesRaw, insumosRaw, sucursalesRaw, ordenesPorSucursalRaw, marketStockRaw, alertasRaw, hoyVsSemanaRaw], frescura, mapa] =
      await Promise.all([Promise.all(fetches), leerFrescura(rpc, client_id || '', zona, cfgDayparts.inicioDia), leerMapa(credLectura, client_id)])
    // FALLA ≠ VACÍO: un mapa que no se pudo leer se reporta como fuente fallida.
    if (!mapa.ok) fuentesFallidas.push('mapa de datos (consulta libre)')
    const hayConsultaLibre = mapa.ok && mapa.tablas.length > 0

    // OCM Fase 3: si el tenant no tiene histórico en wansoft_daily (todo cliente clonado
    // del esqueleton), sintetizamos las filas diarias desde su pos_orders vivo. Mismo shape
    // → todo el análisis de abajo (día top, meseros, platillos, pagos, tendencias) sigue igual.
    let recentDays: Record<string, unknown>[] = recentDaysRaw || []
    // `false` = la lectura FALLO. No es lo mismo que "no hubo ventas", y la IA tiene
    // que poder decir la diferencia. Ver pos-daily.ts / LecturaDiariaFallida.
    let ventasDeterminadas = true
    let motivoVentas = ''
    // FUENTE PRINCIPAL = POS DE FULLSITE. Wansoft (wansoft_daily) queda sólo como
    // histórico viejo: si su último día tiene más de 2 días, o el tenant ya opera en
    // Fullsite, los días recientes salen de pos_orders y se pegan encima del histórico.
    let fuenteVentas = recentDays.length > 0 ? 'wansoft' : 'fullsite'
    const ultimoWansoft = recentDays.length > 0 ? String(recentDays[0].fecha || '') : ''
    const haceDosDias = sumarDias(todayStr, -2, zona)
    if (recentDays.length === 0) {
      const estado = await buildDailyConEstado(sbUrl, sbHeaders, client_id || '', histLimit)
      recentDays = estado.dias
      ventasDeterminadas = estado.determinado
      if (!estado.determinado) motivoVentas = estado.motivo
      // Los dos lados fallaron → no se sabe nada. Si sólo falló el histórico, se dice aparte.
      if (recentDaysRaw === null && estado.determinado && estado.dias.length === 0) {
        ventasDeterminadas = false
        motivoVentas = 'no se pudo leer el histórico de ventas y el POS no tiene ventas en el periodo'
      }
    } else if (clientConfig.data_source === 'fullsite' || ultimoWansoft < haceDosDias) {
      const estado = await buildDailyConEstado(sbUrl, sbHeaders, client_id || '', histLimit)
      if (!estado.determinado) fuentesFallidas.push('ventas del POS')
      if (estado.determinado && estado.dias.length > 0) {
        const nuevos = estado.dias.filter(d => String((d as Record<string, unknown>).fecha || '') > ultimoWansoft)
        if (nuevos.length > 0) {
          recentDays = [...nuevos, ...recentDays].slice(0, histLimit)
          fuenteVentas = 'fullsite+wansoft'
        }
      }
    }

    // 3. Waiter × platillo data — process results from parallel fetch
    let waiterContext = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const waiterRows = (waiterRowsRaw || []) as Array<{ fecha: string; data: any }>
    if (wantsMeseros) {

    if (waiterRows && waiterRows.length > 0) {
      // Detect if question mentions a specific mesero
      const allMeseros = new Set<string>()
      for (const row of waiterRows) {
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        for (const key of Object.keys(d)) {
          if (!key.startsWith('__')) allMeseros.add(key)
        }
      }

      let meseroMatch: string | null = null
      for (const name of allMeseros) {
        const parts = name.toLowerCase().split(' ')
        if (parts.some(p => p.length > 3 && q.includes(p))) {
          meseroMatch = name
          break
        }
      }

      // Aggregate waiter data across days
      const aggGrupo: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggPlatillo: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggKPIs: Record<string, { bebidas: number; alimentos: number; personas: number; tickets: number }> = {}
      const aggCats: Record<string, Record<string, { qty: number; total: number }>> = {}

      for (const row of waiterRows) {
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data

        // Mesero × grupo
        for (const [mesero, grupos] of Object.entries(d.__por_mesero_grupo || {})) {
          if (!aggGrupo[mesero]) aggGrupo[mesero] = {}
          for (const [grupo, vals] of Object.entries(grupos as Record<string, { qty: number; total: number }>)) {
            if (!aggGrupo[mesero][grupo]) aggGrupo[mesero][grupo] = { qty: 0, total: 0 }
            aggGrupo[mesero][grupo].qty += vals.qty || 0
            aggGrupo[mesero][grupo].total += vals.total || 0
          }
        }

        // Mesero × platillo
        for (const [mesero, platillos] of Object.entries(d.__por_mesero_platillo || {})) {
          if (!aggPlatillo[mesero]) aggPlatillo[mesero] = {}
          for (const [plat, vals] of Object.entries(platillos as Record<string, { qty: number; total: number }>)) {
            if (!aggPlatillo[mesero][plat]) aggPlatillo[mesero][plat] = { qty: 0, total: 0 }
            aggPlatillo[mesero][plat].qty += vals.qty || 0
            aggPlatillo[mesero][plat].total += vals.total || 0
          }
        }

        // KPIs and categories per mesero
        for (const [key, val] of Object.entries(d)) {
          if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
          const meseroData = val as Record<string, unknown>
          // KPIs
          if (meseroData.KPIs && typeof meseroData.KPIs === 'object') {
            const kpi = meseroData.KPIs as Record<string, number>
            if (!aggKPIs[key]) aggKPIs[key] = { bebidas: 0, alimentos: 0, personas: 0, tickets: 0 }
            aggKPIs[key].bebidas += kpi.bebidas_total || 0
            aggKPIs[key].alimentos += kpi.alimentos_total || 0
            aggKPIs[key].personas += kpi.personas || 0
            aggKPIs[key].tickets += kpi.tickets || 0
          }
          // Categories (H&H, Pan, etc.)
          for (const [cat, catVal] of Object.entries(meseroData)) {
            if (cat === 'KPIs' || typeof catVal !== 'object' || catVal === null) continue
            const cv = catVal as Record<string, number>
            if ('qty' in cv) {
              if (!aggCats[key]) aggCats[key] = {}
              if (!aggCats[key][cat]) aggCats[key][cat] = { qty: 0, total: 0 }
              aggCats[key][cat].qty += cv.qty || 0
              aggCats[key][cat].total += cv.total || 0
            }
          }
        }
      }

      try {
        // Sólo las etiquetas GENÉRICAS del POS legacy que no son personas. Antes aquí
        // había nombres reales de un restaurante; quién es mesero lo decide la lista de
        // "Meseros activos" (pos_staff del propio tenant) que va en el prompt.
        const excludeNames = ETIQUETAS_NO_MESERO

        const rankings: string[] = []

        // Build simple text rankings
        const meseroList = Object.entries(aggKPIs).filter(([name]) =>
          !excludeNames.some(ex => name.toLowerCase().includes(ex))
        )

        rankings.push('RANKING H&H POR MESERO:')
        for (const [m] of meseroList) {
          const hh = aggCats[m]?.['H&H']
          rankings.push(`  ${datoTexto(m, 60)}: ${hh ? hh.qty : 0} pzas ($${hh ? Math.round(hh.total) : 0})`)
        }

        rankings.push('\nRANKING 2DA BEBIDA POR MESERO:')
        for (const [m] of meseroList) {
          const bd = aggCats[m]?.['2da Bebida']
          rankings.push(`  ${datoTexto(m, 60)}: ${bd ? bd.qty : 0} pzas`)
        }

        rankings.push('\nRANKING BEBIDAS POR PERSONA:')
        for (const [m, k] of meseroList) {
          const bp = k.personas > 0 ? (k.bebidas / k.personas).toFixed(2) : '0'
          rankings.push(`  ${datoTexto(m, 60)}: ${bp}`)
        }

        rankings.push('\nRANKING PAN/TOAST/BAGEL POR MESERO:')
        for (const [m] of meseroList) {
          const pan = aggCats[m]?.['Pan']
          rankings.push(`  ${datoTexto(m, 60)}: ${pan ? pan.qty : 0} pzas ($${pan ? Math.round(pan.total) : 0})`)
        }

        rankings.push('\nRANKING POSTRES POR MESERO:')
        for (const [m] of meseroList) {
          const post = aggCats[m]?.['Postres']
          if (post && post.qty > 0) rankings.push(`  ${datoTexto(m, 60)}: ${post.qty} pzas ($${Math.round(post.total)})`)
        }

        // Per-day category breakdown (for "cuántos H&H por día" queries)
        const perDayLines: string[] = ['\nDESGLOSE POR DÍA Y CATEGORÍA:']
        for (const row of waiterRows) {
          const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
          const dayTotals: Record<string, { qty: number; total: number }> = {}
          for (const [key, val] of Object.entries(d)) {
            if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
            for (const [cat, catVal] of Object.entries(val as Record<string, unknown>)) {
              if (cat === 'KPIs' || typeof catVal !== 'object' || catVal === null) continue
              const cv = catVal as Record<string, number>
              if ('qty' in cv) {
                if (!dayTotals[cat]) dayTotals[cat] = { qty: 0, total: 0 }
                dayTotals[cat].qty += cv.qty || 0
                dayTotals[cat].total += cv.total || 0
              }
            }
          }
          if (Object.keys(dayTotals).length > 0) {
            const parts = Object.entries(dayTotals)
              .filter(([, v]) => v.qty > 0)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([cat, v]) => `${datoTexto(cat, 40)}:${v.qty}pzas/$${Math.round(v.total)}`)
              .join(', ')
            perDayLines.push(`  ${row.fecha}: ${parts}`)
          }
        }

        const fechas = waiterRows.map((r: { fecha: string }) => r.fecha).join(', ')
        waiterContext = `\nDATOS DE MESEROS POR CATEGORÍA — fechas ${fechas} (úsalos SÓLO para esas fechas; si preguntan por otro día que no está en la lista, di las fechas reales de estos datos):\n\n${rankings.join('\n')}${perDayLines.length > 1 ? '\n' + perDayLines.join('\n') : ''}`
        console.log(`[chat] Rankings OK: ${rankings.length} lines, ${meseroList.length} meseros, ${waiterContext.length} chars`)
      } catch (err) {
        console.error('[chat] Rankings error:', err)
      }
    }
    } // end wantsMeseros

    // 2b. Process food cost (from parallel fetch)
    // Recipe map from Excel costeo = SOURCE OF TRUTH for unit costs
    let foodCostContext = ''
    const normName = claveReceta
    const recipeMap = new Map<string, { costo: number; precio: number; pct: number }>()
    if (Array.isArray(recipesRaw)) {
      for (const r of recipesRaw) {
        const costo = Number(r.costo_total)
        if (costo > 0) recipeMap.set(normName(String(r.nombre || '')), { costo, precio: Number(r.precio_venta) || 0, pct: Number(r.pct_costo) || 0 })
      }
    }
    // Alias nombre en POS → nombre de la receta en el costeo. Son DATOS DE UN TENANT
    // (typos de su propio menú), así que viven indexados por tenant y sólo aplican a
    // ese tenant; los demás usan únicamente la clave tolerante `claveReceta`
    // (acentos, "&"/"AND"/"DE", letras dobles), que cubre la mayoría de los casos.
    const RECIPE_ALIASES: Record<string, string> = ALIAS_RECETAS_POR_TENANT[client_id] || {}
    for (const [alias, canonical] of Object.entries(RECIPE_ALIASES)) {
      const target = recipeMap.get(normName(canonical))
      if (target && !recipeMap.has(normName(alias))) recipeMap.set(normName(alias), target)
    }

    if (wantsFoodCost && Array.isArray(fcRowsRaw) && fcRowsRaw.length > 0) {
      try {
        const fcData = typeof fcRowsRaw[0].data === 'string' ? JSON.parse(fcRowsRaw[0].data as string) : fcRowsRaw[0].data
        if (Array.isArray(fcData) && fcData.length > 0) {
          let totalVentas = 0
          let totalCosto = 0
          const fcLines = fcData
            .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.subtotal_venta || 0) - Number(a.subtotal_venta || 0))
            .slice(0, 20)
            .map((item: Record<string, unknown>) => {
              const nombre = datoTexto(item.platillo || item.nombre || 'Sin nombre')
              const grupo = datoTexto(item.grupo || '', 40)
              const qty = Number(item.cantidad || 0)
              const ventaTotal = Number(item.subtotal_venta || 0)
              // Prefer Excel recipe cost (real) over stale scraped costo_real
              const recipe = recipeMap.get(normName(nombre))
              // SOLO recetas reales (pos_recipes/Excel). El costo_real scrapeado de Wansoft está stale y da márgenes falsos.
              const costoReal = recipe && qty > 0 ? qty * recipe.costo : 0
              const costoPct = ventaTotal > 0 ? (costoReal / ventaTotal) * 100 : 0
              const precioUnit = qty > 0 ? Math.round(ventaTotal / qty) : 0
              if (costoReal <= 0) {
                return `${nombre} (${grupo}): ${qty}pzas, Venta $${Math.round(ventaTotal)}, PU $${precioUnit} [SIN COSTEO — no hay receta; NO afirmes costo ni margen de este platillo, di que falta costearlo]`
              }
              totalVentas += ventaTotal
              totalCosto += costoReal
              const costoUnit = recipe ? Math.round(recipe.costo) : (qty > 0 ? Math.round(costoReal / qty) : 0)
              return `${nombre} (${grupo}): ${qty}pzas, Venta $${Math.round(ventaTotal)}, Costo $${Math.round(costoReal)} (${costoPct.toFixed(1)}%), PU $${precioUnit}, CU $${costoUnit}${recipe ? ' [receta real]' : ''}`
            })
          const overallPct = totalVentas > 0 ? ((totalCosto / totalVentas) * 100).toFixed(1) : '0'
          // El mix es UNA FOTO de un día: se dice cuál. Si es vieja, se dice que es vieja.
          const fcFecha = String(fcRowsRaw[0].fecha || '')
          const fcAtraso = fcFecha ? diasEntre(fcFecha, todayStr) : 0
          const fcAviso = fcAtraso > DIAS_PARA_DATO_VIEJO ? ` — OJO: foto de hace ${fcAtraso} días, no es el mix actual; dilo al usarla` : ''
          foodCostContext = `\n\nMIX DE VENTAS POR PLATILLO (snapshot del ${fcFecha || 'fecha desconocida'}${fcAviso}; top vendidos, costo según receta real cuando existe — ${overallPct}% sobre los platillos CON costeo; los marcados SIN COSTEO no entran al promedio):\n${fcLines.join('\n')}\nINSUMO MÁS CARO=mayor CU. MÁS COMPRADO=mayor cantidad.`
        }
      } catch { /* */ }
    }

    // Add recipes from Excel costeo
    if (wantsFoodCost && Array.isArray(recipesRaw) && recipesRaw.length > 0) {
      const conPrecio = recipesRaw.filter((r) => Number(r.precio_venta) > 0 && Number(r.pct_costo) > 0 && Number(r.pct_costo) < 100)
      const avgPct = conPrecio.length > 0 ? (conPrecio.reduce((s, r) => s + Number(r.pct_costo), 0) / conPrecio.length).toFixed(1) : '0'
      // Reverse alias map: nombre de receta → alias con el que aparece en el POS/ventas
      const aliasesByCanonical = new Map<string, string[]>()
      for (const [alias, canonical] of Object.entries(RECIPE_ALIASES)) {
        const key = normName(canonical)
        aliasesByCanonical.set(key, [...(aliasesByCanonical.get(key) || []), alias.replace(/\s+/g, ' ').trim()])
      }
      const recLines = recipesRaw
        .filter((r) => Number(r.costo_total) > 0)
        .map((r) => {
          const ings = Array.isArray(r.ingredientes) ? r.ingredientes : (typeof r.ingredientes === 'string' ? JSON.parse(r.ingredientes as string) : [])
          // Todos los ingredientes con costo > 0 (los $0 son basura del parseo del Excel)
          const topIngs = (ings as Record<string, unknown>[]).filter((i) => Number(i.total) > 0)
            .map((i) => {
              const porcion = Number(i.porcion)
              const um = String(i.um || '').toUpperCase().replace(/\./g, '')
              const costoUm = Number(i.costo_um)
              // Normalizar a unidades legibles: KG→gramos, LT→ml, GR ya es gramos
              let cant = ''
              if (porcion > 0) {
                if (um === 'KILO' || um === 'KG') cant = `${Math.round(porcion * 1000)}g`
                else if (um === 'LT' || um === 'LITRO') cant = porcion < 1 ? `${Math.round(porcion * 1000)}ml` : `${porcion}L`
                else if (um === 'GR') cant = `${porcion}g`
                else if (um === 'PZ' || um === 'PZA' || um === 'PIEZA') cant = `${porcion} pz`
                else cant = `${porcion}${um ? ` ${um}` : ' un.'}`
              }
              const umLabel = um === 'KILO' || um === 'KG' ? 'KG' : um === 'LITRO' || um === 'LT' ? 'LT' : um === 'PZA' || um === 'PIEZA' ? 'PZ' : (um || 'un.')
              const unitario = costoUm > 0 ? ` a $${costoUm}/${umLabel}` : ''
              return `${datoTexto(i.nombre, 60)}${cant ? ` ${cant}` : ''}${unitario}:$${Number(i.total).toFixed(1)}`
            }).join(', ')
          const aliases = aliasesByCanonical.get(normName(String(r.nombre || '')))
          const aliasNote = aliases ? ` [en el POS se vende como: ${aliases.join(', ')}]` : ''
          return `${datoTexto(r.nombre)}${aliasNote}: PV $${r.precio_venta}, Costo $${Number(r.costo_total).toFixed(0)} (${r.pct_costo}%) → ${topIngs}`
        })
      if (recLines.length > 0) {
        foodCostContext += `\n\nFOOD COST TEÓRICO PROMEDIO: ${avgPct}% (sobre ${conPrecio.length} platillos del costeo real con precio). Esta es la fuente correcta para "food cost general".\nRECETAS CON DESGLOSE DE INGREDIENTES (${recLines.length} platillos — costos REALES del costeo, fuente de verdad):\n${recLines.join('\n')}\nFormato de cada ingrediente: NOMBRE cantidad a $precio/unidad:$costo_en_el_platillo. Ej. "RIB EYE 180g a $295/KG:$53.1" = el platillo lleva 180 gramos de rib eye, el kilo cuesta $295 y esa porción cuesta $53.10. SÍ tienes gramajes y costos por kilo — úsalos. Cuando pidan una receta, lista TODOS los ingredientes que aparecen con su gramaje y costo, sin omitir ninguno.\nNOTA: platillos con PV $0 son extras/modificadores sin precio propio — no usarlos para promedios.`
      }
    }

    // Add ALL insumos con precio (compacto) — para "cuánto cuesta el kilo de X", proveedores, mermas
    if (wantsFoodCost && Array.isArray(insumosRaw) && insumosRaw.length > 0) {
      const conPrecioIns = insumosRaw.filter((i) => Number(i.precio_limpio) > 0)
      const sinPrecioIns = insumosRaw.length - conPrecioIns.length
      const insLines = conPrecioIns
        .sort((a, b) => Number(b.precio_limpio || 0) - Number(a.precio_limpio || 0))
        .map((i) => {
          const merma = Number(i.merma_pct) > 0 ? ` merma ${i.merma_pct}%` : ''
          return `${datoTexto(i.nombre)}: $${Number(i.precio_limpio).toFixed(0)}/${datoTexto(i.um, 12)} | ${i.proveedor ? datoTexto(i.proveedor, 60) : 's/proveedor'}${merma}`
        })
      foodCostContext += `\n\nLISTA COMPLETA DE INSUMOS (${conPrecioIns.length} con precio limpio, ordenados del más caro al más barato; formato: NOMBRE: $precio/unidad | proveedor | merma):\n${insLines.join('\n')}`
      if (sinPrecioIns > 0) foodCostContext += `\n(${sinPrecioIns} insumos más existen pero no tienen precio capturado — si preguntan por uno que no está en la lista, dilo.)`
    }

    // 2c. Process reservaciones (from parallel fetch)
    let reservasContext = ''
    if (wantsReservas && reservasRaw === null) {
      // FALLO ≠ VACÍO: antes esto decía "No hay reservaciones futuras registradas".
      reservasContext = '\n\nRESERVACIONES: NO PUDE LEER las reservaciones en este momento. NO digas que no hay reservaciones; di que no pudiste consultarlas y que lo intente de nuevo. [Ver reservaciones →](/reservar)'
    } else if (wantsReservas && Array.isArray(reservasRaw) && reservasRaw.length > 0) {
      const lines = reservasRaw.map((r) => `${datoTexto(r.fecha, 10)} ${datoTexto(r.horario_inicio || '', 8)} | ${datoTexto(r.nombre, 60)} | ${Number(r.guests) || 0} personas | ${datoTexto(r.espacio, 40)} | ${datoTexto(r.paquete || '', 40)} | $${Math.round(Number(r.total) || 0)} | ${datoTexto(r.status, 20)}`)
      reservasContext = `\n\nRESERVACIONES PRÓXIMAS desde ${todayStr} (${reservasRaw.length}${reservasRaw.length >= 20 ? ', se muestran sólo las primeras 20' : ''}):\n${lines.join('\n')}\n\nSi preguntan por "próxima reservación", da la primera de esta lista.`
    } else if (wantsReservas) {
      reservasContext = `\n\nRESERVACIONES: no hay reservaciones registradas a partir de ${todayStr} (lectura correcta).`
    }

    // 2d. Process POS orders (from parallel fetch)
    let ordersContext = ''
    if (wantsOrders && ordersRaw === null) {
      ordersContext = `\n\nÓRDENES POS: NO PUDE LEER las órdenes del ${ordDesde} al ${ordHasta}. No digas que no hubo órdenes ni cancelaciones.`
    } else if (wantsOrders && Array.isArray(ordersRaw) && ordersRaw.length === 0) {
      ordersContext = `\n\nÓRDENES POS del ${ordDesde} al ${ordHasta} (por día de venta): ninguna orden registrada en el POS en ese periodo. Dilo con esas fechas.`
    } else if (wantsOrders && Array.isArray(ordersRaw) && ordersRaw.length > 0) {
      const byStatus: Record<string, { count: number; total: number }> = {}
      for (const o of ordersRaw) {
        const s = String(o.status || 'unknown')
        if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 }
        byStatus[s].count++
        byStatus[s].total += Number(o.total) || 0
      }
      const statusLines = Object.entries(byStatus).map(([s, d]) => `  ${datoTexto(s, 20)}: ${d.count} órdenes, $${Math.round(d.total)}`)
      const canceladas = ordersRaw.filter((o) => o.status === 'cancelada')
      let cancelInfo = ''
      if (canceladas.length > 0) {
        cancelInfo = `\nCANCELADAS (${canceladas.length}; se listan hasta 5):\n${canceladas.slice(0, 5).map((o) => `  ${datoTexto(o.dia_venta, 10)} | Mesa ${datoTexto(o.mesa, 10)} | ${datoTexto(o.mesero, 60)} | $${Math.round(Number(o.total) || 0)}`).join('\n')}`
      }
      const tope = ordersRaw.length >= LIMITE_ORDENES ? ` — OJO: se alcanzó el tope de ${LIMITE_ORDENES} órdenes leídas; los conteos están INCOMPLETOS, dilo` : ''
      ordersContext = `\n\nÓRDENES POS del ${ordDesde} al ${ordHasta} (por día de venta; ${ordersRaw.length} órdenes${tope}; ya contadas):\n${statusLines.join('\n')}${cancelInfo}`
    }

    // 2d-2. Market inventory
    // ── SUCURSALES ──────────────────────────────────────────────────────────
    // Antes el chat no sabía que un cliente podía tener sucursales: a "¿cuál es
    // mi mejor restaurante?" contestaba "dime cuáles son". Se le dan los nombres
    // y el desempeño de cada una para que compare solo.
    let sucursalesContext = ''
    if (Array.isArray(sucursalesRaw) && sucursalesRaw.length > 0) {
      const nombrePorId = new Map<string, string>()
      for (const l of sucursalesRaw as { id?: string; name?: string }[]) {
        if (l.id && l.name) nombrePorId.set(l.id, datoTexto(l.name, 60))
      }

      const acum = new Map<string, { ventas: number; tickets: number }>()
      for (const o of (ordenesPorSucursalRaw || []) as { location_id?: string; total?: number | string }[]) {
        const id = o.location_id || '(sin sucursal)'
        const monto = Number(o.total) || 0   // PostgREST devuelve numeric como STRING
        const a = acum.get(id) || { ventas: 0, tickets: 0 }
        a.ventas += monto; a.tickets += 1
        acum.set(id, a)
      }

      const filas = [...acum.entries()]
        .map(([id, a]) => ({
          nombre: nombrePorId.get(id) || id,
          ventas: a.ventas,
          tickets: a.tickets,
          promedio: a.tickets ? a.ventas / a.tickets : 0,
        }))
        .sort((x, y) => y.ventas - x.ventas)

      const listado = [...nombrePorId.values()].join(', ')
      sucursalesContext = `\nSUCURSALES DE ESTE CLIENTE (${nombrePorId.size}): ${listado}\n`

      if (ordenesPorSucursalRaw === null) {
        sucursalesContext += `No pude leer las ventas por sucursal: NO compares sucursales ni digas que alguna vendió $0.\n`
      } else if (filas.length === 0) {
        sucursalesContext += `DESEMPEÑO POR SUCURSAL del ${sucDesde} al ${todayStr}: SIN COBERTURA — el POS no tiene ventas registradas en ese periodo; no se puede comparar sucursales (no digas $0).\n`
      }
      if (filas.length > 0) {
        const truncado = (ordenesPorSucursalRaw?.length || 0) >= LIMITE_SUCURSALES
        sucursalesContext += `\nDESEMPEÑO POR SUCURSAL del ${sucDesde} al ${todayStr} (POS, ventas cobradas; ya calculado, NO lo recalcules)${truncado ? ` — OJO: se alcanzó el tope de ${LIMITE_SUCURSALES} órdenes leídas, los totales están INCOMPLETOS (faltan las órdenes más viejas del periodo); dilo al comparar` : ''}:\n`
        for (const f of filas) {
          sucursalesContext += `  ${f.nombre}: $${Math.round(f.ventas).toLocaleString('es-MX')} en ${f.tickets} tickets, ticket promedio $${Math.round(f.promedio).toLocaleString('es-MX')}\n`
        }
        sucursalesContext += `La mejor por ventas es ${filas[0].nombre}. La de menor venta es ${filas[filas.length - 1].nombre}.\n`
        sucursalesContext += `Si te preguntan cuál es la mejor, contesta con estos números y di por qué (ventas totales vs ticket promedio pueden dar ganadores distintos).\n`
      }
    }

    // ── VENTA POR HORARIO (brunch / lunch / merienda / dinner…) ───────────────
    // Cada restaurante define sus franjas en /configuracion/horarios-venta. El % se
    // calcula en Postgres (ventas_por_franja) con la hora real de cada orden, total y
    // sólo comida, y por sucursal. La IA recibe el resultado ya hecho.
    let franjasContext = ''
    // Mismas filas para la gráfica "franjas" (no se vuelven a leer).
    let franjasGrafica: { filas: FilaFranja[]; config: DaypartsConfig; desde: string; hasta: string } | null = null
    try {
      const { config: franjasCfg, esDefault: franjasDefault, inicioDia } = cfgDayparts
      if (preguntaDeFranjas(q, franjasCfg)) {
        const qn = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const diasAtras = qn.includes('hoy') ? 0 : qn.includes('ayer') ? 1 : /semana/.test(qn) ? 6 : wantsYear ? 364 : 29
        const hasta = qn.includes('ayer') ? restarDias(todayStr, 1) : todayStr
        const desde = restarDias(todayStr, diasAtras)
        const filas = await ventasPorFranja({ sbUrl, sbKey, clientId: client_id || '', desde, hasta, config: franjasCfg, tz: zona, inicioDia })
        if (filas) {
          franjasGrafica = { filas, config: franjasCfg, desde, hasta }
          const nombres = new Map<string, string>()
          for (const l of (sucursalesRaw || []) as { id?: string; name?: string }[]) if (l.id && l.name) nombres.set(l.id, datoTexto(l.name, 60))
          franjasContext = contextoFranjas({ filas, config: franjasCfg, esDefault: franjasDefault, desde, hasta, nombreSucursal: id => nombres.get(id) || id })
        }
      }
    } catch { /* franjas opcionales: sin ellas el chat sigue funcionando */ }

    let marketContext = ''
    if (wantsMarket && Array.isArray(marketStockRaw) && marketStockRaw.length > 0) {
      const agotados = marketStockRaw.filter((m: Record<string, unknown>) => Number(m.stock) <= 0)
      const bajoStock = marketStockRaw.filter((m: Record<string, unknown>) => Number(m.stock) > 0 && Number(m.reorder_point) > 0 && Number(m.stock) <= Number(m.reorder_point))
      const conStock = marketStockRaw.filter((m: Record<string, unknown>) => Number(m.stock) > 0)
      marketContext = `\n\nINVENTARIO MARKET (${marketStockRaw.length} items):\n- Con stock: ${conStock.length}\n- Agotados: ${agotados.length}\n- Bajo punto de reorden: ${bajoStock.length}`
      if (agotados.length > 0) {
        marketContext += `\nAGOTADOS: ${agotados.slice(0, 10).map((m: Record<string, unknown>) => datoTexto(m.menu_item_id, 60)).join(', ')}`
      }
      if (bajoStock.length > 0) {
        marketContext += `\nBAJO STOCK: ${bajoStock.slice(0, 10).map((m: Record<string, unknown>) => `${datoTexto(m.menu_item_id, 60)}(${Number(m.stock) || 0})`).join(', ')}`
      }
    }

    // ── CONOCIMIENTO NATIVO (tablas propias de Fullsite, funciones fs_*) ─────────
    const intent = intencion(q)
    const natDesde = dateFilter?.start || restarDias(todayStr, 89)
    const natHasta = dateFilter?.end || todayStr
    // La frescura va primero: con la fecha de la última venta del POS, "0 ventas de
    // ese producto" se distingue de "el POS no tiene cobertura en esas fechas".
    const frescuraCtx = textoFrescura(frescura, zona, todayStr)
    const ultimaVentaPos = frescura ? frescura.ultimaFecha : undefined
    // Filas del top de productos (sin búsqueda) para la gráfica "top_platillos".
    const productosGrafica: { topFilas?: Record<string, unknown>[] } = {}
    const [productoNativo, recetaCtx, insumoCtx] = await Promise.all([
      intent.producto ? contextoProducto(rpc, client_id || '', message, natDesde, natHasta, zona, ultimaVentaPos, productosGrafica) : Promise.resolve(''),
      intent.receta ? contextoReceta(rpc, client_id || '', message) : Promise.resolve(''),
      (intent.insumo || intent.receta) ? contextoInsumo(rpc, client_id || '', message) : Promise.resolve(''),
    ])
    const fuenteCtx = fuenteVentas === 'fullsite+wansoft'
      ? `\nFUENTE DE VENTAS: POS de Fullsite para los días posteriores a ${ultimoWansoft}; antes de esa fecha, histórico importado.\n`
      : fuenteVentas === 'wansoft' ? `\nFUENTE DE VENTAS: histórico importado (último día ${ultimoWansoft}); el POS de Fullsite no tiene ventas más recientes.\n` : ''

    // 2e. Product search — FULL platillos list (incl. Market) from wansoft_data.platillos_full
    // platillos_top solo trae top 30/día; productos chicos del Market (ej. Smarty chips) nunca aparecen ahí.
    let productContext = ''
    const wantsProducto = ['vendid', 'market', 'cuant', 'cuánt', 'producto', 'piezas', 'unidades'].some(kw => q.includes(kw))
    if (productoNativo && !productoNativo.includes('0 ventas registradas')) productContext = productoNativo
    if (wantsProducto && !productContext) {
      try {
        const pfStart = dateFilter?.start || todayStr.slice(0, 8) + '01'
        const pfEnd = dateFilter?.end || todayStr
        const pfLeidas = await leer(`${sbUrl}/rest/v1/wansoft_data?client_id=eq.${encodeURIComponent(client_id || '')}&data_key=eq.platillos_full&fecha=gte.${pfStart}&fecha=lte.${pfEnd}&select=fecha,data&order=fecha.asc&limit=92`, 'lista completa de platillos (histórico)')
        const pfRows = (pfLeidas || []) as Array<{ fecha: string; data: unknown }>
        if (pfRows.length > 0) {
          // Tokens de búsqueda: palabras del mensaje (4+ letras) que no son stopwords
          const stop = new Set(['cuantas', 'cuantos', 'cuanta', 'cuanto', 'vendido', 'vendidas', 'vendidos', 'vendieron', 'vendimos', 'venta', 'ventas', 'tienes', 'tiene', 'sobre', 'desde', 'hasta', 'para', 'este', 'esta', 'estos', 'estas', 'donde', 'dónde', 'como', 'cómo', 'producto', 'productos', 'piezas', 'unidades', 'restaurante', 'market', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'semana', 'inventario'])
          const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const tokens = norm(message).split(/[^a-z0-9ñ]+/).filter(t => t.length >= 4 && !stop.has(t))
          // Agregar por producto a través de los días
          const agg = new Map<string, { cantidad: number; total: number; dias: number }>()
          for (const row of pfRows) {
            const items = parseJsonb(row.data) as Array<{ nombre?: string; cantidad?: number; total?: number }>
            for (const it of items) {
              if (!it.nombre) continue
              const nm = norm(it.nombre)
              if (tokens.length > 0 && !tokens.some(t => nm.includes(t))) continue
              const cur = agg.get(it.nombre) || { cantidad: 0, total: 0, dias: 0 }
              cur.cantidad += Number(it.cantidad) || 0
              cur.total += Number(it.total) || 0
              cur.dias++
              agg.set(it.nombre, cur)
            }
          }
          const fechas = pfRows.map(r => r.fecha)
          const cobertura = `${fechas[0]} a ${fechas[fechas.length - 1]} (${fechas.length} días con datos)`
          if (tokens.length > 0 && agg.size > 0) {
            const lines = [...agg.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 30)
              .map(([nm, v]) => `  ${datoTexto(nm)}: ${v.cantidad} pzas, $${Math.round(v.total)} (${v.dias} días)`)
            productContext = `\n\nPRODUCTOS ENCONTRADOS (histórico importado, lista COMPLETA de platillos incl. Market; hay datos del ${cobertura}; búsqueda: ${datoTexto(tokens.join(', '))}):\n${lines.join('\n')}\nUsa estas cantidades y di el periodo REAL de los datos (no el que se pidió, si es distinto).`
          } else if (tokens.length > 0) {
            // Hay datos para ESOS días; fuera de ellos no hay cobertura. Se dice así.
            const ultimoPf = fechas[fechas.length - 1]
            const hueco = ultimoPf < pfEnd ? ` Después del ${ultimoPf} NO hay datos en el histórico (sin cobertura hasta ${pfEnd}): dilo.` : ''
            productContext = `\n\nBÚSQUEDA DE PRODUCTO "${datoTexto(tokens.join(' '))}": 0 ventas registradas en el histórico importado en los días con datos (${cobertura}). Di que no aparece vendido en esas fechas.${hueco}`
          }
        }
      } catch { /* non-blocking */ }
    }

    // 3. Build daily context
    // Sin esto, la IA veia una lista vacia y respondia "no hubo ventas" — afirmandolo.
    // Un numero equivocado dicho con seguridad es peor que no tener el numero.
    let dailyContext = ventasDeterminadas
      ? 'SIN COBERTURA DE VENTAS: no hay ventas registradas (ni POS ni histórico) en el periodo leído. Di "no tengo ventas registradas para ese periodo"; NO digas $0.'
      : `LAS VENTAS NO SE PUDIERON CONSULTAR (${datoTexto(motivoVentas, 120)}). NO tienes los datos: `
        + 'no digas que no hubo ventas ni des ninguna cifra. Di que no pudiste consultarlas '
        + 'y sugiere reintentar o revisar en la caja.'
    const quiereGrafica = /graf|chart|muestra|hazme/.test(qSinAcentos)
    // Para el catálogo de gráficas: filas por hora (hora pico) y ventana leída.
    let horasGrafica: Record<string, unknown>[] | null = null
    let ventanaGrafica: string | undefined
    if (recentDays && recentDays.length > 0) {
      const lines = recentDays.map((d: Record<string, unknown>) => {
        const dowNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
        const dow = dowNames[new Date(d.fecha + 'T12:00:00').getDay()]
        const ventasDia = Number(d.ventas_dia) || 0

        const personas = Number(d.personas_restaurant) || 0
        const ticketPromedio = personas > 0 ? Math.round(ventasDia / personas) : 0
        let line = `${d.fecha} (${dow}): Ventas $${ventasDia}, ${personas} personas, TicketPromedio $${ticketPromedio}`

        if (wantsDetail) {
          const descuentos = Number(d.descuentos) || 0
          if (descuentos > 0) line += `, Descuentos $${descuentos}`
          const propinas = Number(d.propinas_total) || 0
          if (propinas > 0) line += `, Propinas $${Math.round(propinas)}`

          const meseros = parseJsonb(d.meseros) as { nombre: string; total: number }[]
          if (meseros.length > 0) {
            const topM = meseros.sort((a: { total: number }, b: { total: number }) => Number(b.total) - Number(a.total)).slice(0, 10)
              .map((m: { nombre: string; total: number }) => `${datoTexto(m.nombre, 60)}:$${Math.round(Number(m.total) || 0)}`).join(', ')
            line += ` | Meseros: ${topM}`
          }

          const grupos = parseJsonb(d.ventas_por_grupo) as { nombre: string; total: number }[]
          if (grupos.length > 0) {
            const topG = grupos.sort((a: { total: number }, b: { total: number }) => Number(b.total) - Number(a.total)).slice(0, 5)
              .map((g: { nombre: string; total: number }) => `${datoTexto(g.nombre, 40)}:$${Math.round(Number(g.total) || 0)}`).join(', ')
            line += ` | Grupos: ${topG}`
          }

          const platillos = parseJsonb(d.platillos_top) as { nombre: string; cantidad: number; total: number }[]
          if (platillos.length > 0) {
            const topP = platillos.slice(0, 15).map((p: { nombre: string; cantidad: number; total: number }) => `${datoTexto(p.nombre, 60)}:${Number(p.cantidad) || 0}pzas/$${Math.round(Number(p.total) || 0)}`).join(', ')
            line += ` | Platillos: ${topP}`
          }

          const pagos = parseJsonb(d.pago_metodos || d['pago_métodos']) as { nombre: string; total: number }[]
          if (pagos.length > 0) {
            const pagoStr = pagos.map((p: { nombre: string; total: number }) => `${datoTexto(p.nombre, 40)}:$${Math.round(Number(p.total) || 0)}`).join(', ')
            line += ` | Pagos: ${pagoStr}`
          }
        }

        return line
      })

      // Resúmenes YA CALCULADOS y con fechas reales: mes actual/anterior en la zona del
      // tenant, "últimos 7 días CON DATOS" con su rango (antes decía "ÚLTIMOS 7 DÍAS"
      // sobre las últimas 7 filas, aunque la última fuera de hace tres semanas), semana
      // de calendario vs la anterior y aviso explícito si los datos son viejos.
      // Ver resumenesPrecalculados (lib/chat-context.ts).
      //
      // `ventanaDesde`: primer día que la lectura cubrió. Si se llenó el límite de filas,
      // lo anterior NO se leyó ("fuera de la ventana", no "sin cobertura").
      const llenoElLimite = recentDays.length >= histLimit
      const ventanaDesde = llenoElLimite
        ? String(recentDays[recentDays.length - 1].fecha || '')
        : fuenteVentas === 'fullsite' ? sumarDias(todayStr, -histLimit, zona) : undefined
      ventanaGrafica = ventanaDesde
      const aggregates = resumenesPrecalculados(recentDays, todayStr, { ventanaDesde })
      const fMax = String(recentDays[0].fecha || '')
      // El detalle día por día es caro en tokens: sin pregunta de historial van los
      // últimos DETALLE_DIAS; los resúmenes de arriba sí cubren todo lo leído.
      const DETALLE_DIAS = 14
      const detalle = (wantsHistory || quiereGrafica) ? lines : lines.slice(0, DETALLE_DIAS)
      const fMinDet = String(recentDays[detalle.length - 1].fecha || '')
      dailyContext = `${aggregates}\nDATOS DIARIOS (${detalle.length} días con ventas, del ${fMinDet} al ${fMax}${detalle.length < lines.length ? `; detalle sólo de los ${detalle.length} más recientes — para fechas anteriores usa los RESÚMENES o pide el historial` : ''}).\n${detalle.join('\n')}`

      // Agrupado por mes (para "gráfica del año" / "por mes"): la IA no suma.
      if (quiereGrafica || wantsHistory) dailyContext += ventasPorMes(recentDays)

      // Pronóstico: promedio simple de los últimos 4 mismos días de la semana, en código.
      if (/pronostico|proyeccion|manana|cuanto vamos a vender|cuanto venderemos/.test(qSinAcentos)) {
        const objetivo = /manana/.test(qSinAcentos) ? sumarDias(todayStr, 1, zona) : todayStr
        dailyContext += pronosticoMismoDia(recentDays, objetivo)
      }

      // Hora pico: snapshots acumulados → venta por franja, calculada aquí.
      if (q.includes('hora') || q.includes('pico') || q.includes('horario')) {
        const hourlyRows = await leer(
          `${sbUrl}/rest/v1/wansoft_hourly?select=fecha,data&client_id=eq.${encodeURIComponent(client_id || '')}&order=fecha.desc&limit=3`,
          'ventas por hora (histórico)',
        )
        if (hourlyRows && hourlyRows.length > 0) {
          horasGrafica = hourlyRows
          dailyContext += ventasPorHoraDesdeAcumulados(hourlyRows)
        }
      }

      // Year-over-Year comparison data
      const wantsYoY = ['año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año', 'comparar año', 'crecimiento', 'creció', 'bajó vs'].some(kw => q.includes(kw))
      if (wantsYoY && recentDays.length > 0) {
        try {
          const currentYear = todayStr.slice(0, 4)
          const prevYear = String(Number(currentYear) - 1)
          // Fetch same months from previous year
          const currentMonth = todayStr.slice(5, 7)
          const yoyRes = await fetch(
            `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,tickets_count,personas_restaurant&client_slug=eq.${encodeURIComponent(client_id || '')}&ventas_dia=gt.0&fecha=gte.${prevYear}-01-01&fecha=lte.${prevYear}-12-31&order=fecha.asc&limit=500`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
          )
          if (yoyRes.ok) {
            let yoyRows = await yoyRes.json()

            // OCM Fase 3 — este bloque era el ultimo que seguia acoplado a
            // wansoft_daily sin salida. Para un tenant clonado la consulta
            // devolvia vacio y el año-contra-año simplemente NUNCA aparecia:
            // no daba una respuesta mala, daba una capacidad que no llegaba
            // jamas, ni despues de un año operando sobre Fullsite.
            //
            // El contrato de pos-daily.ts es explicito: "los agentes NUNCA
            // vuelven a acoplarse a wansoft_daily; cuando viene vacio se llama
            // a esta funcion". Aqui faltaba cumplirlo.
            if (!Array.isArray(yoyRows) || yoyRows.length === 0) {
              // Ventana desde hoy hasta el 1-ene del año anterior, con holgura.
              const diasHastaInicioPrevio = Math.ceil(
                (Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${prevYear}-01-01T00:00:00Z`)) / 86400000
              ) + 1
              const vivas = await buildDailyFromOrders(sbUrl, sbHeaders, client_id || '', diasHastaInicioPrevio)
              yoyRows = vivas.filter((r) => String(r.fecha ?? '').startsWith(prevYear))
            }

            if (yoyRows.length > 0) {
              // Aggregate by month
              const prevMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of yoyRows) {
                const m = (row.fecha as string).slice(0, 7)
                if (!prevMonthly[m]) prevMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                prevMonthly[m].ventas += Number(row.ventas_dia) || 0
                prevMonthly[m].tickets += Number(row.tickets_count) || 0
                prevMonthly[m].dias += 1
              }
              // Current year monthly
              const currMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of recentDays) {
                const m = (row.fecha as string).slice(0, 7)
                if (!currMonthly[m]) currMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                currMonthly[m].ventas += Number(row.ventas_dia) || 0
                currMonthly[m].tickets += Number(row.tickets_count) || 0
                currMonthly[m].dias += 1
              }
              const yoyLines = [`\nCOMPARATIVO AÑO ANTERIOR (${currentYear} vs ${prevYear}; ya calculado; "sin datos" = SIN COBERTURA, no $0):`]
              const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
              for (let m = 1; m <= 12; m++) {
                const mm = m.toString().padStart(2, '0')
                const curr = currMonthly[`${currentYear}-${mm}`]
                const prev = prevMonthly[`${prevYear}-${mm}`]
                if (curr || prev) {
                  const lado = (x: { ventas: number; tickets: number; dias: number } | undefined, anio: string) => x
                    ? `${anio}=$${Math.round(x.ventas)} (${x.dias} días con datos, TP $${x.tickets > 0 ? Math.round(x.ventas / x.tickets) : 0})`
                    : `${anio}=sin datos`
                  const pct = curr && prev && prev.ventas > 0 ? Math.round(((curr.ventas - prev.ventas) / prev.ventas) * 100) : null
                  const cambio = pct === null ? 'no comparable' : `${pct >= 0 ? '+' : ''}${pct}%${curr!.dias !== prev!.dias ? ' (cobertura desigual)' : ''}`
                  yoyLines.push(`  ${monthNames[m-1]}: ${lado(curr, currentYear)} vs ${lado(prev, prevYear)} → ${cambio}`)
                }
              }
              dailyContext += yoyLines.join('\n')
            }
          }
        } catch { /* YoY optional */ }
      }
    }

    // 3b. Hoy vs el mismo día de la semana pasada, CORTADO A LA MISMA HORA (en código).
    let hoyVsSemanaCtx = ''
    const hoyVsSemanaEntrada = wantsHoyVsSemana && Array.isArray(hoyVsSemanaRaw) ? {
      ordenes: hoyVsSemanaRaw,
      semanaPasada: sumarDias(todayStr, -7, zona),
      corteSemanaPasada: Date.now() - 7 * 864e5,
      horaCorte: horaEnZona(zona),
      truncado: hoyVsSemanaRaw.length >= LIMITE_SUCURSALES,
    } : null
    if (hoyVsSemanaEntrada) {
      hoyVsSemanaCtx = compararHoyMismaHora({ ...hoyVsSemanaEntrada, hoy: todayStr })
    }

    // 3b-2. CATÁLOGO DE GRÁFICAS: sólo con los datos que YA se leyeron arriba. El modelo
    //       no escribe datos de gráficas; elige un ID y el servidor pone el spec.
    const catalogoGraficas = construirCatalogo({
      hoy: todayStr,
      zona,
      inicioDia: dia.inicio.slice(0, 5),
      dias: recentDays || [],
      fuenteVentas: fuenteVentas as FuenteVentasChat,
      ventasDeterminadas,
      ventanaDesde: ventanaGrafica,
      hoyVsSemana: hoyVsSemanaEntrada,
      franjas: franjasGrafica,
      productos: productosGrafica.topFilas ? { filas: productosGrafica.topFilas, desde: natDesde, hasta: natHasta } : null,
      horas: horasGrafica,
    })
    const lineasGraficas = lineasCatalogoParaPrompt(catalogoGraficas)

    // 3c. Alertas abiertas de los agentes (misma tabla y mismo filtro que /agentes y la
    //     lista de atención: `desdeEventos` descarta resueltas, vencidas y de baja confianza).
    let alertasCtx = ''
    if (wantsAlertas && Array.isArray(alertasRaw)) {
      alertasCtx = contextoAlertas(desdeEventos(alertasRaw as unknown as EventoAgente[]), 48)
    }

    // 4a. Fetch active meseros from pos_staff
    let activeMeserosStr = ''
    const staffRows = await leer(
      `${sbUrl}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(client_id || '')}&active=eq.true&role=in.(mesero,cajero,barra,supervisor)&select=name&order=name.asc`,
      'lista de meseros activos',
    )
    if (staffRows && staffRows.length > 0) {
      activeMeserosStr = staffRows.map(r => datoTexto(r.name, 60)).join(', ')
    } else if (staffRows) {
      activeMeserosStr = '(no hay meseros activos registrados en el POS)'
    } else {
      activeMeserosStr = '(no pude leer la lista de meseros activos)'
    }

    const fuentesFallidasCtx = contextoFuentesFallidas(fuentesFallidas)

    // ── LECTURA UNIVERSAL: mapa de tablas + herramienta consultar_datos ─────────
    // El mapa va DENTRO del bloque de datos (nombres y comentarios son texto de la base).
    const mapaCtx = bloqueMapa(mapa, message)
    const siNoEsta = hayConsultaLibre
      ? 'si la cifra NO está en el contexto, CONSÚLTALA con consultar_datos; si tampoco se puede, di "no lo tengo" y da lo más cercano que SÍ esté, con su fecha.'
      : 'si la cifra que te piden NO está en el contexto, di "no lo tengo calculado" y da lo más cercano que SÍ esté, con su fecha.'
    const reglasConsulta = hayConsultaLibre ? `
REGLA #2 — CONSULTA LIBRE (herramienta consultar_datos):
Además de los bloques precalculados tienes el MAPA DE DATOS (dentro del bloque de datos, al final): las tablas de este restaurante con sus columnas y fechas.
1. RUTA RÁPIDA: si un bloque precalculado ya contesta la pregunta, contesta con él SIN consultar.
2. Usa consultar_datos para lo demás: cruzar secciones (p. ej. ventas contra asistencia o gastos), tablas que no vienen precalculadas, periodos a la medida, análisis por HORA DEL DÍA o FRANJA (comida, cena) con las columnas de hora de apertura/cierre del mapa, conteos o rankings específicos. Si el dato requiere ese nivel de detalle, CONSÚLTALO — no digas "no tengo acceso a ese detalle": si la columna está en el mapa, sí lo tienes. Máximo ${MAX_CONSULTAS} consultas por respuesta: pide lo justo y agrega en SQL (GROUP BY, LIMIT).
3. SQL de Postgres de sólo lectura (una sentencia SELECT/WITH) con los nombres EXACTOS de tablas y columnas del mapa, sin esquema y sin filtrar por client_id (ya viene filtrado). Funciones permitidas: agregados, fecha/hora (date_trunc, extract, to_char, now), texto, jsonb (jsonb_array_elements, ->, ->>), ventanas y es_venta(status, payment_status).
4. Sumas, promedios, conteos y porcentajes se hacen EN SQL; nunca los calcules tú.
5. Si la consulta regresa error, corrígela con el mensaje; si no puedes, di que no pudiste consultarlo.
6. Nombra las columnas por su unidad: dinero con total/venta/importe/ticket/precio (p. ej. "as venta_total"), porcentajes con pct (p. ej. "as pct_bebidas", ya multiplicado por 100). Así se verifican tus cifras.
${pistasDelMapa(mapa.ok ? mapa.tablas : [])}

HONESTIDAD CON CONSULTAS:
- Todo número de tu respuesta sale de un bloque precalculado o del resultado de una consulta. Cero cuentas mentales.
- Di el rango de fechas que cubren los datos que usaste.
- Si usaste histórico importado, dilo.
- Si el dato no está (la tabla no existe en el mapa, o 0 filas), dilo: "no tengo registros de <tema> para <periodo>". Si el periodo cae fuera de las fechas del mapa, es SIN COBERTURA, no $0.
- No muestres SQL ni nombres de tablas o columnas al usuario, salvo que lo pida explícitamente.${enVoz
  ? '\n- Modo voz: NUNCA menciones nombres de tablas, columnas ni SQL; habla del tema ("tus ventas", "la asistencia").'
  : '\n- Gráfica de una consulta: si el resultado trae "grafica", puedes poner ese marcador (<!--grafica:consulta-N-->) en su propia línea. Si no lo trae, esa consulta no se puede graficar. Nunca escribas sus datos.'}
` : ''

    // Bloque de datos del prompt: además de ir al modelo, es EVIDENCIA del verificador de
    // números (lo que el modelo puede citar). Las reglas del prompt NO son evidencia.
    const bloqueDatos = `MESEROS ACTIVOS: ${activeMeserosStr}
${fuentesFallidasCtx}
${sucursalesContext}
${franjasContext}
${alertasCtx}
${waiterContext}
${foodCostContext}
${reservasContext}
${ordersContext}
${marketContext}
${productContext || productoNativo}
${recetaCtx}
${insumoCtx}
${frescuraCtx}
${fuenteCtx}
${hoyVsSemanaCtx}

${dailyContext}
${mapaCtx}`

    // 4. System prompt — Unified sharp copilot (same as Telegram)
    //
    // Los EJEMPLOS usan marcadores (<Mesero A>, <$X>) y no nombres ni cifras reales:
    // un ejemplo con "Omar vendió $12,533" se filtraba a las respuestas de OTROS
    // restaurantes y el modelo lo repetía como dato. Los números salen del bloque de
    // datos, nunca del ejemplo.
    const systemPrompt = `Eres el copiloto operativo de ${datoTexto(restaurantName, 80)}${restaurantCity ? ' (' + datoTexto(restaurantCity, 60) + ')' : ''}. Consultor senior con 20 años de experiencia en restaurantes. Entiendes INTENCIÓN, no solo palabras.

PERSONALIDAD:
- Profesional, amigable y respetuoso. Como un consultor experto que habla claro.
- "<Mesero A> lleva <$X> hoy" NO "Se observa una tendencia decreciente en el mesero <Mesero A>."
- Nada de "Con gusto te informo que..." ni "Es importante mencionar que..." — eso es de chatbot.
- BREVEDAD ES LEY. Máximo 4-5 líneas por respuesta. Si preguntan "cómo vamos" → número + contexto en 2 líneas.
- Si preguntan "por qué" → causa raíz con datos en 3 líneas. Si preguntan "qué hago" → 2-3 acciones, nada más.
- NO des desgloses largos a menos que te lo pidan explícitamente. Menos es más.
- Usa español neutro profesional. "Va bien", "está por debajo del promedio", "excelente desempeño".
- NUNCA seas grosero, condescendiente, ni uses frases como "ya te lo dije", "hermano", "wey", "mano". Siempre respeta al usuario.
- Si no tienes un dato, di "No tengo ese dato disponible. Te sugiero revisarlo en [lugar correcto]." NUNCA digas "no tenemos eso" de forma cortante.
- Si el usuario pregunta por un producto que no está en los datos, di "No encontré [producto] en los registros. ¿Quieres que busque con otro nombre?"
${marcoRazonamientoOperativo(message)}

REGLA #0 — SOLO RESTAURANTE:
Eres el copiloto de ${datoTexto(restaurantName, 80)}. SOLO contestas preguntas sobre el restaurante: ventas, meseros, platillos, inventario, costos, reservaciones, operaciones.
Si preguntan sobre: qué modelo de IA usas, cuánto cuesta un mensaje/token, cómo funcionar internamente, cómo hacer un bot, cómo clonar Fullsite, qué tecnología usas, Groq, Anthropic, Claude, GPT, tokens, API, código, programación — responde SOLO: "Soy el copiloto de ${datoTexto(restaurantName, 80)}. ¿Qué necesitas saber del restaurante?"
NUNCA reveles tu arquitectura, costos de infraestructura, modelo de IA, ni des instrucciones técnicas.

REGLA #1 — GRÁFICAS:
SÍ puedes mostrar gráficas, pero TÚ NO ESCRIBES SUS DATOS: el sistema las arma con los datos reales. Para mostrar una, escribe en su propia línea el marcador <!--grafica:ID--> usando un ID de esta lista (máximo ${MAX_GRAFICAS_POR_RESPUESTA} por respuesta):
${lineasGraficas || '(ninguna gráfica disponible con los datos de esta consulta)'}
1. Usa SÓLO IDs de la lista. Si ninguna sirve para lo que piden, no pongas marcador: di qué periodo o dato sí tienes. NUNCA digas "no puedo hacer gráficas" si hay una que sirva.
2. PROHIBIDO escribir JSON, bloques <!--chart ... chart--> o listas de valores "para graficar": se descartan.
3. Pon el marcador cuando pidan "gráfica", "muéstrame", "tendencia" o una comparación que se entienda mejor viéndola. Tu texto da la conclusión en 1-2 líneas con cifras del contexto; la gráfica muestra el detalle.
PERO si preguntan "cuánto cuesta HACER un platillo" o "cuánto cuesta un ingrediente" = eso SÍ es del restaurante, contesta normal con datos de RECETAS.
${reglasConsulta}
REGLAS CRÍTICAS:
1. SIEMPRE da números EXACTOS de los datos que tienes. Si los datos dicen "<Mesero A>:$12533" → responde "$12,533".
2. BUSCA A FONDO antes de decir que no tienes un dato. Revisa: Meseros, Grupos, Platillos, Pagos, Resúmenes, Rankings, Desglose por día.
3. USA LOS RESÚMENES PRE-CALCULADOS (mes, últimos 7 días completos vs los 7 anteriores, hoy vs semana pasada a la misma hora, pronóstico, ventas por mes, ventas por hora). Ya están calculados. HOY es un día EN CURSO: nunca compares su total parcial contra días completos.
4. NO HAGAS ARITMÉTICA: no sumes, restes, promedies ni saques porcentajes tú; ${siNoEsta}
5. FECHAS REALES SIEMPRE: cada cifra que des va con su fecha o periodo real. Si el dato es de otro día que el que preguntaron, dilo ("el último día con datos es <fecha>: ..."). Puedes contestar sobre cualquier fecha pasada que esté en los datos (historial completo), siempre con su fecha.
6. SIN COBERTURA ≠ CERO: si el contexto dice "SIN COBERTURA" o "no hay ventas registradas" para un periodo, NUNCA digas "$0", "no se vendió" ni "no abrieron": di "no tengo ventas registradas para <periodo>; la última venta registrada es <fecha>".
7. FALLO ≠ VACÍO: si una fuente aparece en "FUENTES QUE NO SE PUDIERON LEER" o dice "NO PUDE LEER", di que no pudiste consultarla; no digas que no hay registros.
8. NUNCA inventes números que no estén en los datos. PROHIBIDO usar "estimado", "aproximadamente", "típicamente", "en promedio del sector". Tampoco proyectes impacto en pesos ("esto sube $X") si ese número no está en el contexto.
9. Todos los montos son en PESOS MEXICANOS. NUNCA digas dólares ni USD.

EJEMPLOS DE FORMA (los <...> son marcadores: SIEMPRE se reemplazan con valores del bloque de datos, nunca se copian):
Pregunta: "¿Quién fue el mejor mesero ayer?"
Respuesta: "<Mesero A> con <$X> el <fecha>. Le siguen <Mesero B> (<$Y>) y <Mesero C> (<$Z>)."

Pregunta: "¿Cuál es el ticket promedio del mes?"
Respuesta: "Este mes (<rango de fechas con datos>) va en <$X> por persona. El mes pasado cerró en <$Y>." (del RESUMEN MES ACTUAL / MES ANTERIOR)

Pregunta: "¿Cuántos <platillo> vendimos ayer?"
Respuesta: "<N> piezas por <$X> el <fecha>." (de Platillos del día; si ese día no está en los datos, dilo)

Pregunta: "¿Cómo vamos hoy?"
Respuesta: usa HOY vs MISMO DÍA DE LA SEMANA PASADA A LA MISMA HORA si está. Si el contexto dice SIN COBERTURA para hoy, di "no tengo ventas registradas hoy; la última venta registrada es <fecha>" y, si ayudas, da el último día con datos con su fecha. NUNCA inventes números.

CÓMO INTERPRETAR (lee la intención, no las palabras):
- "cómo vamos" / "qué onda" / "cómo van las ventas" → HOY vs MISMO DÍA DE LA SEMANA PASADA A LA MISMA HORA (ya calculado)
- "quién es el crack" / "mejor mesero" → ranking por ventas (RANKING MESEROS, con sus fechas)
- "quién es el manco" / "peor mesero" → el de menos ventas + por qué, con datos
- "por qué bajaron" → categorías + meseros que cambiaron vs historial, citando fechas
- "cuántos <categoría de upselling>" → DESGLOSE POR DÍA Y CATEGORÍA si existe
- "cómo subo el ticket" → qué categorías de upselling están bajas + quién no las vende (de los rankings)
- "compara A con B" → las métricas de cada uno que estén en los datos
- "me conviene quitar X" → ventas del item en los datos; sin inventar impacto
- "qué hago ahorita" → 2-3 acciones concretas basadas en los datos; sin prometer pesos que no estén calculados
- "descuentos" / "cortesías" → campo "Descuentos $X" de los datos diarios
- "pronóstico" / "mañana" → usa PRONÓSTICO (ya calculado). Si dice NO CALCULABLE, dilo. No calcules tú.
- "combo" / "qué le sugiero" → basado en los platillos más vendidos de los datos
- "por qué bajaron en <mes>" → VENTAS POR MES y datos diarios de ese mes vs anteriores. Solo lo que los datos muestran.
- "tarjeta" / "efectivo" / "método de pago" → "Pagos:" en datos diarios. Si no hay para esa fecha, di "no tengo desglose de pagos para esa fecha".
- "food cost" / "costo" / "margen" / "insumo" / "ingrediente" → MIX DE VENTAS / RECETAS / INSUMOS (di la fecha del snapshot del mix).
- "reserva" / "evento" / "fiesta" → RESERVACIONES.
- "órdenes" / "cancelaciones" / "mesas abiertas" → ÓRDENES POS (di el periodo que cubren).
- "alertas" / "qué está mal" / "problemas" / "qué debo atender" → ALERTAS DE LOS AGENTES.
- "compara X vs Y" (días) → ambos días en datos diarios, TODAS las métricas que estén.
- "año pasado" / "crecimiento" / "yoy" → COMPARATIVO AÑO ANTERIOR (ya calculado; "sin datos" = sin cobertura).
- "qué le dirías al dueño/gerente" → resumen ejecutivo con 3 puntos + acciones
- "hace un mes" / fechas pasadas → contesta con los datos de esas fechas (el historial sí lo tienes), diciendo las fechas reales.
- "brunch" / "lunch" / "dinner" / "merienda" / "desayuno" / "cena" / "horario" / "% de mi venta de comida por horario" → usa VENTA POR HORARIO. Da el % de cada franja (de la venta total y, si preguntan por comida, de la venta de COMIDA), el ticket por franja y, si hay varias sucursales, compáralas. Si los horarios son GENÉRICOS dilo y manda a configurarlos. [Ver horarios →](/configuracion/horarios-venta)
- "hora pico" → VENTAS POR HORA (ya calculadas, con fecha). Si no hay, di "no tengo desglose por hora".
- "propinas" → "Propinas $X" en datos diarios. Si un día no trae ese campo, di que para ese día no hay propinas registradas. NO inventes montos.
- "inventario" / "stock" / "market" → INVENTARIO MARKET si hay datos. Si preguntan por ingredientes de cocina, di que se revisa en /pos/inventario.
- "vs semana pasada" / "comparado con" → ÚLTIMOS 7 DÍAS COMPLETOS vs LOS 7 ANTERIORES (ya calculado, con fechas y días con datos; hoy va aparte porque está en curso). Si dice SIN COBERTURA, NO COMPARABLE o cobertura desigual, dilo.
- Si algo NO está en el contexto (ninguna sección lo trae calculado): ${hayConsultaLibre ? 'consúltalo con consultar_datos; si no se puede, di "no lo tengo"' : 'di "no lo tengo calculado"'} en vez de calcularlo.
- Cualquier nombre propio → buscar en TODOS los datos disponibles

FECHA DE HOY: ${fechaLargaEnZona(zona)}, ${horaEnZona(zona)} (zona ${zona}). DÍA DE VENTA EN CURSO: ${todayStr} (el día de venta empieza a las ${dia.inicio.slice(0, 5)}; antes de esa hora sigue siendo el día anterior). "Hoy" = ${todayStr}. Úsalo para ubicar "ayer", "la semana pasada", "mañana", etc.

FORMATO DE DATOS (lee esto para saber dónde buscar):
- Cada día tiene: "fecha (día): Ventas $X, N personas, TicketPromedio $Y | Meseros: <Mesero A>:$X, <Mesero B>:$Y | Grupos: <CATEGORÍA>:$X | Platillos: <PLATILLO>:Npzas/$X"
- MESEROS están después de "| Meseros:" con nombre:$total. El de mayor $ es el mejor.
- PLATILLOS están después de "| Platillos:" con nombre:cantidadpzas/$total.
- GRUPOS = categorías del menú de ESTE restaurante.
- RANKINGS por categoría y DESGLOSE POR DÍA están en bloque aparte por mesero (si existen).
- RESÚMENES al inicio tienen totales del MES y SEMANA ya calculados, con sus fechas. USA ESOS.

EXCLUIR (no son meseros): cualquier nombre que NO aparezca en la lista de "Meseros activos" más abajo. APLICACIONES y MESERO EVENTO no son personas.

LINKS DEL DASHBOARD — REGLA IMPORTANTE:
Cuando tu respuesta mencione un tema que tiene una página en el dashboard, SIEMPRE agrega un link al final con formato: [Ver detalle →](/ruta)
Usa SOLO rutas de esta lista (rutas internas que empiezan con "/"). NUNCA pongas links externos. NUNCA describas el caminito (sidebar → sección → página) — solo da el link.

Rutas disponibles:
- Ventas del día/semana/mes → [Ver ventas →](/ventas)
- Meseros ranking/rendimiento → [Ver meseros →](/meseros)
- Platillos más vendidos → [Ver platillos →](/platillos)
- Tendencias/comparativos → [Ver tendencias →](/tendencias)
- Venta por horario (brunch/lunch/dinner) → [Ver horarios →](/configuracion/horarios-venta)
- Propinas → [Ver propinas →](/propinas)
- Food cost/margen/recetas → [Ver food cost →](/food-cost)
- Recetas/ingredientes → [Ver recetas →](/recetas)
- Inventario/stock → [Ver inventario →](/inventario)
- Toma física de inventario → [Toma física →](/inventario-real/toma-fisica)
- Puntos de reorden → [Reorden →](/inventario-real/reorden)
- Entradas de inventario → [Entradas →](/inventario-real/entradas)
- Estado de resultados/P&L → [Ver estado de resultados →](/estado-resultados)
- Nómina/empleados → [Ver nómina →](/nomina)
- Gastos/facturas proveedor → [Ver gastos →](/gastos)
- Costos/proveedores → [Ver costos →](/costos)
- Cortes de caja → [Ver cortes →](/cortes)
- Control de efectivo/caja → [Ver caja →](/caja)
- Conciliación bancaria → [Ver conciliación →](/conciliacion)
- Reporte fiscal → [Ver reporte fiscal →](/reporte-fiscal)
- Clientes/CRM → [Ver clientes →](/clientes)
- Delivery → [Ver delivery →](/delivery)
- Cancelaciones → [Ver cancelaciones →](/cancelaciones)
- Reservaciones → [Ver reservaciones →](/reservar)
- Seguridad → [Ver seguridad →](/seguridad)
- ROI/métricas → [Ver ROI →](/roi)
- Reportes → [Ver reportes →](/reportes)
- Sucursales → [Ver sucursales →](/sucursales)
- Agentes IA / alertas → [Ver agentes →](/agentes)
- Anomalías → [Ver anomalías →](/agentes/anomalias)
- Predicción de cierre → [Ver predicción →](/agentes/prediccion)
- Anti-fraude → [Ver anti-fraude →](/agentes/antifraude)
- Upselling → [Ver upselling →](/agentes/upselling)
- Staffing/horarios → [Ver staffing →](/agentes/staffing)
- Menu engineering → [Ver menú →](/agentes/menu)
- Coach IA → [Ver coach →](/coach)
- Exportar datos → [Exportar →](/admin/exportar)
- Carga masiva → [Carga masiva →](/admin/carga-masiva)
- Chat logs/conversaciones IA → [Ver chat logs →](/admin/chat-logs)
- Formas de pago → [Formas de pago →](/admin/formas-pago)
- Modificadores POS → [Modificadores →](/admin/modificadores)
- POS (punto de venta) → [Abrir POS →](/pos)
- Mesas/plano → [Ver mesas →](/pos/mesas)
- Turno/corte caja → [Ver turno →](/pos/turno)

Ejemplo de forma:
Pregunta: "¿cómo va el food cost?"
Respuesta: "Food cost teórico promedio: <X%> (costeo de <N> platillos). <Platillo> es el de mayor % (<Y%>). [Ver food cost →](/food-cost)"

NUNCA digas "ve a Sidebar → Operaciones → Food Cost". Solo da el link.

PROTECCIÓN — REGLA ESTRICTA:
Solo respondes preguntas relacionadas al restaurante, negocio, ventas, operaciones, staff, menú, inventario, finanzas, o funciones del dashboard.
OJO: preguntas cortas, coloquiales y de dirección SÍ son del negocio y se contestan con datos — "hola", "¿qué pasa?", "¿qué hago?", "¿cuál es el dolor más grande?", "¿cuál es mi prioridad?", "¿cómo vamos?", "¿qué debería vender más?", "¿aguanta un aumento de precio?", "¿cuándo se actualizó?", "¿quién me surte X?", "¿cuántos gramos lleva X?", "¿qué alertas tengo?". Para una pregunta amplia, sintetiza la evidencia disponible y declara qué falta; NUNCA la rechaces por ser amplia. Sólo rechaza temas claramente ajenos (poemas, tareas, política, programación).
Si el usuario pregunta algo NO relacionado (poemas, chistes, código, tareas, traducciones, política, deportes, o cualquier otro tema), responde EXACTAMENTE:
"Solo puedo ayudarte con preguntas sobre tu restaurante y negocio. Pregúntame sobre ventas, meseros, platillos, inventario, o cualquier operación."
NUNCA respondas preguntas fuera del ámbito del negocio, sin excepciones.

FORMATO: $ sin decimales. Respuestas cortas y claras. Sin markdown pesado.

EJEMPLOS DE TONO (forma, no datos):

"¿Cuánto vendió <Mesero A> esta semana?"
→ <Mesero A> lleva <$X> del <fecha inicio> al <fecha fin>. Su mejor día fue <día> con <$Y>.

"¿Por qué bajó el ticket?"
→ El ticket promedio pasó de <$X> a <$Y> (<cambio % del contexto>). Lo que más cambió en los datos:
1. <categoría> — <dato del contexto>.
2. <otro dato del contexto>.
Sugerencia: <acción concreta>. (Sin prometer un monto que no esté calculado.)

"<producto que no existe>"
→ No encontré "<producto>" en los registros de venta. ¿Quieres que busque con otro nombre o revisar el menú completo?

"¿Qué hago ahorita para vender más?"
→ STAFF BRIEF (5 min):
1. <categoría de upselling más baja según los rankings> en toda mesa
2. <segunda oportunidad según los datos>
3. <tercera>
${enVoz ? `\n${instruccionModoVoz()}\n` : ''}
${envolverDatos(bloqueDatos)}`

    // Groq — free, with retry on rate limit
    const groq = await import('@/lib/groq')
    const mensajes: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
      // Sólo 'user' y 'assistant' del historial del cliente: un 'system' (o 'tool')
      // en el cuerpo de la petición es un intento de reescribir las reglas.
      // Las gráficas del historial vuelven compactadas a su marcador (el JSON gastaba
      // el tope de caracteres y enseñaba al modelo a copiar datos).
      ...historialSeguro(compactarGraficasEnHistorial(history), 8),
      { role: 'user', content: message.slice(0, 4000) },
    ]

    // Gráfica de cada consulta (armada en el servidor con SUS filas; se calcula una vez).
    const specsConsulta = new Map<number, GraficaSpec | null>()
    const specDeConsulta = (c: ConsultaHecha): GraficaSpec | null => {
      if (!specsConsulta.has(c.n)) {
        specsConsulta.set(c.n, c.resultado.ok
          ? graficaDeConsulta(
            { paraQue: c.paraQue, sql: c.sql, filas: c.resultado.filas, truncado: c.resultado.truncado },
            { datosHastaRespaldo: mapa.ok ? datosHastaDeTablas(c.sql, mapa.tablas) : undefined },
          )
          : null)
      }
      return specsConsulta.get(c.n) ?? null
    }

    let text: string
    let ciclo: ResultadoCiclo | null = null
    if (hayConsultaLibre) {
      // Ciclo de consultas: máx. 4, ~20 s. p_client_id = el tenant AUTENTICADO, nunca
      // algo que venga del usuario o del modelo.
      ciclo = await responderConHerramientas({
        mensajes,
        modelo: o => groq.modeloConHerramientas({ ...o, maxTokens: 4000 }),
        consultar: (sql, ms) => ejecutarConsulta(credLectura, client_id, sql, ms),
        respaldo: m => groq.groqChat({ messages: m, maxTokens: 4000 }),
        marcadorGrafica: enVoz ? undefined : c => (specDeConsulta(c) ? `<!--grafica:${claveConsulta(c.n)}-->` : null),
      })
      text = ciclo.texto
    } else {
      text = await groq.groqChat({ messages: mensajes, maxTokens: 4000 })
    }
    // Observabilidad: conteos, tiempos y errores; NUNCA filas ni SQL (no hay nivel debug en el repo).
    console.log(`[chat] lectura universal ${JSON.stringify({
      auth: credLectura.modo,
      mapa: mapa.ok ? mapa.tablas.length : `fallo: ${mapa.motivo}`,
      consultas: ciclo?.consultas.length ?? 0,
      ms_consultas: ciclo?.msConsultas ?? 0,
      llamadas_modelo: ciclo?.llamadasModelo ?? 1,
      agotado: ciclo?.agotado ?? null,
      respaldo: ciclo?.respaldo ?? false,
      errores: ciclo?.errores ?? [],
    })}`)

    // ── VERIFICADOR DE NÚMEROS ──────────────────────────────────────────────────
    // Garantía: ningún número sin rastro en los datos llega al dueño (texto y voz). Se
    // verifica el texto del modelo ANTES de insertar gráficas (sus specs las arma el
    // servidor con filas reales). Evidencia = bloque de datos + celdas de las consultas +
    // pregunta del usuario. Una ronda de reparación; lo que quede, "[sin verificar]".
    // Lo que escribió el usuario (pregunta, historial) y el nombre del restaurante sólo
    // respaldan CONTEOS: su "$15,000" o su "20%" nunca respaldan un monto o un % de la respuesta.
    const evidencia = new Evidencia().agregarTexto(bloqueDatos)
      .agregarTexto(message, { soloConteos: true }).agregarTexto(restaurantName, { soloConteos: true })
    for (const h of Array.isArray(history) ? history as { role?: unknown; content?: unknown }[] : []) {
      // Sólo lo que escribió el usuario: una respuesta previa del asistente en el cuerpo de
      // la petición la manda el cliente y no se puede usar para "lavar" cifras.
      if (h && h.role === 'user' && typeof h.content === 'string') evidencia.agregarTexto(h.content.slice(0, 4000), { soloConteos: true })
    }
    const evidenciaDeConsultas = (cs: ConsultaHecha[]) => cs.filter(c => c.resultado.ok).flatMap(c => c.resultado.ok ? [c.resultado.filas, c.resultado.n] : [])
    for (const x of evidenciaDeConsultas(ciclo?.consultas || [])) evidencia.agregarValor(x)
    const garantia = await garantizarNumeros({
      texto: text,
      evidencia,
      reparar: async (original, sinRastro) => {
        const previos = ciclo?.consultas || []
        const msgsRep = [
          ...mensajesDeRespaldo(mensajes, previos),
          { role: 'assistant' as const, content: original },
          { role: 'user' as const, content: mensajeReparacion(sinRastro, hayConsultaLibre) },
        ]
        if (hayConsultaLibre) {
          const rep = await responderConHerramientas({
            mensajes: msgsRep,
            modelo: o => groq.modeloConHerramientas({ ...o, maxTokens: 4000 }),
            consultar: (sql, ms) => ejecutarConsulta(credLectura, client_id, sql, ms),
            respaldo: m => groq.groqChat({ messages: m, maxTokens: 4000 }),
            presupuestoMs: 12_000,
            maxConsultas: 2,
          })
          return { texto: rep.texto, evidenciaExtra: evidenciaDeConsultas(rep.consultas) }
        }
        return { texto: await groq.groqChat({ messages: msgsRep, maxTokens: 4000 }) }
      },
    })
    text = garantia.texto
    // Conteos, nunca valores.
    console.log(`[chat] verificador ${JSON.stringify({
      afirmaciones: garantia.afirmaciones,
      sin_rastro: garantia.sinRastroInicial,
      reparado: garantia.reparado,
      marcados: garantia.marcados,
      ms_reparacion: garantia.msReparacion,
      voz: enVoz,
    })}`)

    // Gráficas de consultas → al catálogo como `consulta-N` (sólo formas válidas).
    // Siguen el MISMO camino que las demás (aplicarGraficas): el modelo sólo elige.
    if (ciclo && !enVoz) {
      for (const c of ciclo.consultas) {
        const spec = specDeConsulta(c)
        if (spec) catalogoGraficas.set(claveConsulta(c.n), spec)
      }
    }

    // Gráficas: los marcadores <!--grafica:ID--> se sustituyen por el spec del servidor;
    // un <!--chart escrito por el modelo (datos no verificados) se descarta. En voz no
    // hay gráficas: la respuesta se escucha, y el modelo ofrece "el detalle en pantalla".
    let graficas = aplicarGraficas(text, catalogoGraficas, { sinGraficas: enVoz })
    // Auto-inyectado: pidieron gráfica y el modelo no marcó ninguna → la de la última
    // consulta graficable de esta respuesta; si no hay, la más adecuada del catálogo.
    if (quiereGrafica && !enVoz && graficas.usadas.length === 0) {
      const deConsulta = [...(ciclo?.consultas || [])].reverse().find(c => catalogoGraficas.has(claveConsulta(c.n)))
      if (deConsulta) {
        const clave = claveConsulta(deConsulta.n)
        graficas = anexarGrafica(graficas, catalogoGraficas.get(clave)!, clave)
      } else {
        const id = elegirGraficaPorPregunta(message, catalogoGraficas)
        const spec = id ? catalogoGraficas.get(id) : undefined
        if (spec) graficas = anexarGrafica(graficas, spec)
      }
    }
    const finalText = graficas.texto

    // Hermes feedback: log if response contains "no tengo" for improvement
    if (text.toLowerCase().includes('no tengo') || text.toLowerCase().includes('no cuento')) {
      try {
        await fetch(`${sbUrl}/rest/v1/agent_runs`, {
          method: 'POST',
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            agent_id: 'chat-feedback',
            trigger_type: 'auto',
            status: 'no_data',
            output_summary: `Q: ${message.slice(0, 200)} | A: ${text.slice(0, 200)}`,
            tentacle: 'hermes',
          }),
        })
      } catch { /* non-blocking */ }
    }

    // Cada respuesta tiene un id desde antes de persistir: permite recibir feedback
    // humano sin volver a buscar por texto, fecha o mensaje (que serían ambiguos).
    const chatLogId = crypto.randomUUID()
    // Log conversation to chat_logs (non-blocking)
    const hadError = finalText.toLowerCase().includes('no tengo') || finalText.toLowerCase().includes('no puedo') || finalText.toLowerCase().includes('no cuento')
    fetch(`${sbUrl}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: chatLogId,
        client_id: client_id || '',
        user_id: userId || null,
        user_message: message.slice(0, 2000),
        ai_response: graficas.textoCompacto.slice(0, 5000),
        model: 'groq',
        had_error: hadError,
        error_type: hadError ? (finalText.includes('no tengo') ? 'no_data' : finalText.includes('no puedo') ? 'cant_do' : 'other') : null,
      }),
    }).catch(() => {})

    return Response.json({ response: finalText, chat_log_id: chatLogId })
  } catch (error) {
    console.error('Chat API error:', error)
    const msg = error instanceof Error && error.message.includes('GROQ_API_KEY')
      ? 'Chat IA no disponible — falta configurar GROQ_API_KEY en el servidor.'
      : 'Lo siento, hubo un error al procesar tu mensaje. Intenta de nuevo.'
    return Response.json({ response: msg }, { status: 200 })
  }
}
