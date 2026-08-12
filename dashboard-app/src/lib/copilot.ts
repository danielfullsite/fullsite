// ── Control Plane · Copiloto de super-admin ──────────────────────────────────
// Claude (Anthropic tool-use) con acceso de LECTURA cross-tenant (service_role) y
// ACCIONES que reusan los endpoints /api/platform/* ya existentes (auth + auditoría
// + rate-limit heredados). Las acciones NO se ejecutan solas: el copiloto las
// PROPONE y el humano confirma en la UI. Sólo lo usa la cuenta platform admin.

import { platformServiceFetch } from './platform-auth'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
function model(): string { return process.env.PLATFORM_COPILOT_MODEL || 'claude-haiku-4-5-20251001' }
function anthropicKey(): string { return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPICAPIKEY || '' }

async function sf(path: string): Promise<unknown[]> {
  try {
    const r = await platformServiceFetch(path, { headers: { Accept: 'application/json' } })
    if (!r.ok) return []
    const j = await r.json()
    return Array.isArray(j) ? j : []
  } catch { return [] }
}
function num(v: unknown): number { return typeof v === 'number' ? v : Number(v) || 0 }

// ── Herramientas de LECTURA (se ejecutan solas) ──────────────────────────────
async function toolListTenants(): Promise<unknown> {
  const rows = await sf('clients?select=id,display_name,active,data_source&order=created_at') as Record<string, unknown>[]
  return rows.map(r => ({ id: r.id, nombre: r.display_name, activo: r.active, fuente: r.data_source }))
}

async function toolPlatformOverview(): Promise<unknown> {
  const clients = await sf('clients?select=id,active') as Record<string, unknown>[]
  const dets = await sf("agent_results?select=priority&priority=in.(critical,warning)") as Record<string, unknown>[]
  const since = new Date(Date.now() - 86400000).toISOString()
  const runs = await sf(`agent_runs?select=status&created_at=gte.${since}`) as Record<string, unknown>[]
  return {
    tenants: clients.length,
    tenants_activos: clients.filter(c => c.active).length,
    detecciones_abiertas: dets.length,
    corridas_24h: runs.length,
    errores_24h: runs.filter(r => r.status === 'error').length,
  }
}

async function toolTenantSales(input: Record<string, unknown>): Promise<unknown> {
  const clientId = String(input.client_id || '')
  const days = Math.min(90, Math.max(1, num(input.days) || 7))
  if (!clientId) return { error: 'client_id requerido' }
  // 1) wansoft_daily (histórico por client_slug)
  const w = await sf(`wansoft_daily?client_slug=eq.${encodeURIComponent(clientId)}&select=fecha,ventas_dia,tickets_count&order=fecha.desc&limit=${days}`) as Record<string, unknown>[]
  if (w.length > 0) {
    const ventas = w.reduce((s, r) => s + num(r.ventas_dia), 0)
    const tickets = w.reduce((s, r) => s + num(r.tickets_count), 0)
    return { fuente: 'wansoft_daily', dias: w.length, ventas_total: Math.round(ventas), tickets, ticket_promedio: tickets ? Math.round(ventas / tickets) : 0, desde: w[w.length - 1]?.fecha, hasta: w[0]?.fecha }
  }
  // 2) pos_orders (POS Fullsite)
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const o = await sf(`pos_orders?client_id=eq.${encodeURIComponent(clientId)}&status=eq.pagada&closed_at=gte.${since}&select=total,closed_at`) as Record<string, unknown>[]
  const ventas = o.reduce((s, r) => s + num(r.total), 0)
  return { fuente: 'pos_orders', dias: days, ordenes: o.length, ventas_total: Math.round(ventas), ticket_promedio: o.length ? Math.round(ventas / o.length) : 0 }
}

async function toolAgentsStatus(input: Record<string, unknown>): Promise<unknown> {
  const clientId = input.client_id ? String(input.client_id) : ''
  const cf = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : ''
  const dets = await sf(`agent_results?select=agent_id,priority,summary,fecha,client_id&order=fecha.desc&limit=25${cf}`) as Record<string, unknown>[]
  const since = new Date(Date.now() - 86400000).toISOString()
  const runs = await sf(`agent_runs?select=agent_id,status,created_at&created_at=gte.${since}&order=created_at.desc&limit=40`) as Record<string, unknown>[]
  const errores = runs.filter(r => r.status === 'error').map(r => r.agent_id)
  return {
    detecciones: dets.map(d => ({ agente: d.agent_id, prioridad: d.priority, resumen: d.summary, fecha: d.fecha, tenant: d.client_id })),
    corridas_24h: runs.length,
    agentes_con_error: Array.from(new Set(errores)),
  }
}

const READ_TOOLS: Record<string, (i: Record<string, unknown>) => Promise<unknown>> = {
  list_tenants: toolListTenants,
  get_platform_overview: toolPlatformOverview,
  get_tenant_sales: toolTenantSales,
  get_agents_status: toolAgentsStatus,
}

// ── Herramientas de ACCIÓN (allowlist → endpoint existente) ───────────────────
export interface ActionDef {
  endpoint: string
  buildBody: (i: Record<string, unknown>) => Record<string, unknown>
  summary: (i: Record<string, unknown>) => string
}
export const ACTION_TOOLS: Record<string, ActionDef> = {
  create_tenant: {
    endpoint: '/api/platform/onboard',
    buildBody: i => ({
      clientId: i.client_id, email: i.email, password: i.password,
      display_name: i.display_name, mesas: i.mesas,
    }),
    summary: i => `Crear tenant "${i.display_name || i.client_id}" (id: ${i.client_id}) con dueño ${i.email}`,
  },
  toggle_flag: {
    endpoint: '/api/platform/flags',
    buildBody: i => ({ key: i.key, enabled: i.enabled }),
    summary: i => `${i.enabled ? 'Prender' : 'Apagar'} el flag "${i.key}" (global)`,
  },
  set_tenant_active: {
    endpoint: '/api/platform/tenant-toggle',
    buildBody: i => ({ clientId: i.client_id, active: i.active }),
    summary: i => `${i.active ? 'Activar' : 'Desactivar'} el tenant "${i.client_id}"`,
  },
}

// ── Esquemas de tools para Anthropic ─────────────────────────────────────────
const TOOL_SCHEMAS = [
  { name: 'list_tenants', description: 'Lista todos los tenants (clientes) de Fullsite con su estado.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_platform_overview', description: 'KPIs globales: nº de tenants, activos, detecciones abiertas, corridas y errores de agentes en 24h.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_tenant_sales', description: 'Ventas de un tenant en los últimos N días (ventas totales, tickets, ticket promedio).', input_schema: { type: 'object', properties: { client_id: { type: 'string' }, days: { type: 'number', description: 'default 7' } }, required: ['client_id'] } },
  { name: 'get_agents_status', description: 'Detecciones recientes de los agentes IA y agentes con error en 24h. Opcional: filtra por tenant.', input_schema: { type: 'object', properties: { client_id: { type: 'string' } } } },
  { name: 'create_tenant', description: 'ACCIÓN: da de alta un tenant nuevo (usuario dueño + skeleton completo). Requiere confirmación del humano.', input_schema: { type: 'object', properties: { client_id: { type: 'string', description: 'slug corto, minúsculas/guiones' }, display_name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', description: 'mín 6 chars' }, mesas: { type: 'number' } }, required: ['client_id', 'email', 'password'] } },
  { name: 'toggle_flag', description: 'ACCIÓN: prende/apaga un feature flag global. Requiere confirmación.', input_schema: { type: 'object', properties: { key: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['key', 'enabled'] } },
  { name: 'set_tenant_active', description: 'ACCIÓN: activa/desactiva un tenant. Requiere confirmación.', input_schema: { type: 'object', properties: { client_id: { type: 'string' }, active: { type: 'boolean' } }, required: ['client_id', 'active'] } },
]

interface UIMessage { role: 'user' | 'assistant'; content: string }
export interface CopilotResult { text: string; pendingAction?: { tool: string; input: Record<string, unknown>; summary: string } }

export async function runCopilot(uiMessages: UIMessage[], today: string): Promise<CopilotResult> {
  const key = anthropicKey()
  if (!key) return { text: 'El copiloto no está configurado (falta ANTHROPIC_API_KEY en el servidor).' }

  const system = `Eres el copiloto de super-administrador de Fullsite (plataforma multi-tenant de POS para restaurantes en México). Ayudas al fundador a operar TODOS sus clientes desde un solo lugar.

Tienes herramientas de LECTURA (se ejecutan solas) para consultar datos reales cruzando todos los tenants, y herramientas de ACCIÓN (create_tenant, toggle_flag, set_tenant_active) que NO se ejecutan hasta que el humano confirma — tú sólo las propones.

Reglas:
- Responde SIEMPRE en español, conciso y con números concretos. Montos en MXN con $ y separador de miles.
- Usa las herramientas de lectura para fundamentar tus respuestas; no inventes cifras.
- Antes de proponer una acción, explica brevemente qué vas a hacer.
- Para create_tenant, si falta el password, sugiere uno razonable pero pide confirmación.
- Fecha de hoy: ${today}.`

  // Anthropic content puede ser string o bloques; empezamos con los turnos de la UI (texto).
  const messages: { role: 'user' | 'assistant'; content: unknown }[] =
    uiMessages.slice(-20).map(m => ({ role: m.role, content: m.content }))

  for (let step = 0; step < 8; step++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model(), max_tokens: 1500, system, tools: TOOL_SCHEMAS, messages }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[copilot] anthropic error', res.status, err)
      return { text: `Error del copiloto (${res.status}). Intenta de nuevo.` }
    }
    const data = await res.json()
    const blocks: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] = data.content || []
    const textOut = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim()
    const toolUses = blocks.filter(b => b.type === 'tool_use')

    if (toolUses.length === 0) return { text: textOut || '…' }

    messages.push({ role: 'assistant', content: blocks })

    // ¿Alguna acción? → detener y pedir confirmación.
    const action = toolUses.find(t => t.name && ACTION_TOOLS[t.name])
    if (action) {
      const def = ACTION_TOOLS[action.name!]
      return { text: textOut, pendingAction: { tool: action.name!, input: action.input || {}, summary: def.summary(action.input || {}) } }
    }

    // Ejecutar tools de lectura y devolver resultados.
    const results = []
    for (const t of toolUses) {
      const fn = t.name ? READ_TOOLS[t.name] : undefined
      let out: unknown
      try { out = fn ? await fn(t.input || {}) : { error: 'herramienta desconocida' } }
      catch (e) { out = { error: e instanceof Error ? e.message : String(e) } }
      results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out).slice(0, 6000) })
    }
    messages.push({ role: 'user', content: results })
  }
  return { text: 'Me tomó demasiados pasos; reformula la pregunta por favor.' }
}
