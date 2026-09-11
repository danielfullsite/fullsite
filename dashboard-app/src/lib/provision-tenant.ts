// Provisioning contract: create a pending tenant, seed missing rows only, then
// activate with owner/service memberships in one database transaction. Existing
// configuration, prices, policies, disabled rows and legacy activation survive
// retries. Template staff are inactive and their random PINs do not grant access.
// PostgREST + service role only; no SDK and no anon fallback.
import { randomInt, randomUUID } from 'node:crypto'
import { DEFAULT_ONBOARDING_TEMPLATE, type OnboardingTemplate } from './onboarding-template'
import type { ClientFeatures } from './client-config'
import { resolveVerticalPreset, type VerticalId, type SeedCombo } from './vertical-presets'

// Kept in sync with DEFAULT_FEATURES in src/lib/client-config.ts (which is not
// exported). New tenants get the standard feature set.
const DEFAULT_FEATURES: ClientFeatures = {
  pos: true, posRestaurant: true, posTienda: false, bakery_station: false, delivery: false,
  ecommerce: false, inventory: true, foodCost: true, facturacion: true,
  nomina: false, agentesIA: true, coach: true, chatIA: true,
  resenas: false, giftCards: false,
}

export interface ProvisionInput {
  clientId: string
  display_name?: string
  accent_color?: string
  default_theme?: 'light' | 'dark'
  logo_url?: string
  plan?: string
  mesas?: number
  locations?: Array<{ id?: string; name: string; address?: string }>
  template?: OnboardingTemplate // optional override; defaults to code template
  /** Tipo de restaurante — resuelve un preset de src/lib/vertical-presets.ts
   *  (features + menú semilla + mesas). Ver docs/strategy/BIBLE-SQUARE.md. */
  vertical?: VerticalId
}

export interface ProvisionResult {
  clientId: string
  created: {
    clients: number
    client_locations: number
    pos_menu_categories: number
    pos_menu_items: number
    pos_payment_methods: number
    pos_staff: number
    pos_mesas: number
    pos_combos: number
    pos_mutation_authority: number
    pos_item_inventory_policy: number
  }
  /** PINs de plantilla sembrados en ESTA corrida (vacío si el tenant ya tenía
   *  staff). El alta los muestra una vez — no vuelven a viajar por la red. */
  staffPins: Array<{ role: string; pin: string }>
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

interface ProvisionPlan {
  version: 1
  mesas: number
  template: OnboardingTemplate
  locations: Array<{id:string;name:string;address:string}>
  combos: SeedCombo[]
}
interface ProvisionedClient { id:string; active:boolean; provisioning_state:'pending'|'complete'|null; provisioning_plan:ProvisionPlan|null }
async function readTenant(clientId:string): Promise<ProvisionedClient|null> {
  const response=await checked(await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,active,provisioning_state,provisioning_plan&limit=1`,{headers:headers(),cache:'no-store'}),'read tenant')
  const rows=await response.json()
  if(!Array.isArray(rows)||rows.length>1||(rows.length&&rows[0].id!==clientId)) throw new Error('[provision] invalid tenant lookup')
  return rows[0]||null
}
function requirePlan(value:ProvisionPlan|null):ProvisionPlan {
  if(value?.version!==1||!Number.isSafeInteger(value.mesas)||value.mesas<0||!Array.isArray(value.locations)||!value.locations.length||
    !Array.isArray(value.template?.menu)||!Array.isArray(value.template?.paymentMethods)||!Array.isArray(value.template?.roles)||!Array.isArray(value.combos)) throw new Error('[provision] PROVISION_PLAN_REQUIRED: concilia el plan pendiente')
  return value
}
function capturePlan(input:ProvisionInput):ProvisionPlan {
  const preset=input.vertical?resolveVerticalPreset(input.vertical):null,tpl=input.template||preset?.template||DEFAULT_ONBOARDING_TEMPLATE
  // Explicit projection only: credentials and unknown input properties never enter the plan.
  return {version:1,mesas:input.mesas??preset?.defaultMesas??10,locations:(input.locations?.length?input.locations:[{name:'Principal'}]).map(l=>({id:l.id||randomUUID(),name:l.name.trim(),address:l.address?.trim()||''})),
    template:{menu:tpl.menu.map(c=>({idSuffix:c.idSuffix,name:c.name,color:c.color,sort_order:c.sort_order,items:c.items.map(i=>({idSuffix:i.idSuffix,name:i.name,price:i.price,sort_order:i.sort_order}))})),
      paymentMethods:tpl.paymentMethods.map(m=>({name:m.name,type:m.type,commission_pct:m.commission_pct,fiscal_code:m.fiscal_code})),roles:[...tpl.roles]},
    combos:JSON.parse(JSON.stringify(preset?.combos||[]))}
}
async function prevalidateLocations(plan:ProvisionPlan,clientId:string):Promise<void> {
  if(new Set(plan.locations.map(l=>l.id)).size!==plan.locations.length)throw new Error('[provision] duplicate location identity')
  const ids=`in.(${plan.locations.map(l=>JSON.stringify(l.id)).join(',')})`
  const response=await checked(await fetch(`${SB_URL}/rest/v1/client_locations?id=${encodeURIComponent(ids)}&select=id,client_id`,{headers:headers(),cache:'no-store'}),'scope locations')
  const rows=await response.json()
  if(!Array.isArray(rows)||rows.some(row=>row.client_id!==clientId))throw new Error('[provision] SCOPE_CONFLICT client_locations')
}

function serviceKey(): string {
  // service_role ONLY — never fall back to anon for writes.
  return process.env.SUPABASE_SERVICE_KEY || ''
}

/** Independent random credential; operation/row identity never depends on it. */
export function randomPin10(): string { return String(randomInt(1_000_000_000, 10_000_000_000)) }

function headers() {
  const key = serviceKey()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Idempotent upsert on the table's primary key.
    Prefer: 'resolution=ignore-duplicates,return=representation',
  }
}

async function checked(response: Response, operation: string): Promise<Response> {
  if (!response.ok) throw new Error(`[provision] ${operation} failed (${response.status})`)
  return response
}
async function countFor(table: string, clientId: string): Promise<number> {
  const res = await checked(await fetch(`${SB_URL}/rest/v1/${table}?client_id=eq.${encodeURIComponent(clientId)}&select=id`,
    { headers: { ...headers(), Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' }), `count ${table}`)
  const total = res.headers.get('content-range')?.split('/')[1]
  if (!total || !/^\d+$/.test(total) || !Number.isSafeInteger(Number(total))) throw new Error(`[provision] invalid count ${table}`)
  return Number(total)
}
async function insertMissing(table: string, rows: Record<string, unknown>[], conflictCols?: string): Promise<Record<string, unknown>[]> {
  if (!rows.length) return []
  const suffix = conflictCols ? `?on_conflict=${encodeURIComponent(conflictCols)}` : ''
  const res = await checked(await fetch(`${SB_URL}/rest/v1/${table}${suffix}`, {method:'POST',headers:headers(),body:JSON.stringify(rows),cache:'no-store'}), `insert ${table}`)
  const inserted = await res.json()
  if (!Array.isArray(inserted)) throw new Error(`[provision] invalid insert receipt ${table}`)
  // Ignore-duplicates cannot overwrite foreign rows. Confirm that every requested
  // globally keyed identity belongs to this tenant before continuing the skeleton.
  if (rows.every(row => typeof row.id === 'string' && typeof row.client_id === 'string')) {
    const ids = `in.(${rows.map(row => JSON.stringify(row.id)).join(',')})`
    const check = await checked(await fetch(`${SB_URL}/rest/v1/${table}?id=${encodeURIComponent(ids)}&select=id,client_id`, {headers:headers(),cache:'no-store'}), `scope ${table}`)
    const existing = await check.json()
    if (!Array.isArray(existing) || rows.some(row => !existing.some(item => item.id === row.id && item.client_id === row.client_id))) throw new Error(`[provision] SCOPE_CONFLICT ${table}`)
  }
  return inserted
}
async function upsert(table: string, rows: Record<string, unknown>[]): Promise<number> { return (await insertMissing(table,rows)).length }
async function upsertOnConflict(table: string, rows: Record<string, unknown>[], conflictCols: string): Promise<number> { return (await insertMissing(table,rows,conflictCols)).length }
async function insertRows(table: string, rows: Record<string, unknown>[]): Promise<number> { return (await insertMissing(table,rows,'client_id,number')).length }
function validateInput(input: ProvisionInput) {
  if (!/^[a-z0-9_-]{1,40}$/i.test(input.clientId || '')) throw new Error('[provision] invalid clientId')
  if (!SB_URL || !serviceKey()) throw new Error('[provision] service configuration required')
  if (input.mesas !== undefined && (!Number.isSafeInteger(input.mesas) || input.mesas < 0 || input.mesas > 500)) throw new Error('[provision] invalid mesas')
  if (input.locations && (!Array.isArray(input.locations) || input.locations.length > 100 || input.locations.some(l => typeof l.name !== 'string' || !l.name.trim() || (l.id !== undefined && (typeof l.id !== 'string' || !l.id.trim() || l.id.length > 200))))) throw new Error('[provision] invalid locations')
}
/** Safe to call before/resume provisioning. Never activates or edits an existing tenant. */
export async function provisionTenantBegin(input: ProvisionInput): Promise<{clientId:string;created:number;tenant:ProvisionedClient}> {
  validateInput(input)
  const existing=await readTenant(input.clientId)
  if(existing)return {clientId:input.clientId,created:0,tenant:existing}
  const plan=capturePlan(input),preset=input.vertical?resolveVerticalPreset(input.vertical):null
  // Reject an incorrect explicit location before making it part of durable intent.
  await prevalidateLocations(plan,input.clientId)
  const created = await upsert('clients',[{id:input.clientId,display_name:input.display_name||input.clientId,
    accent_color:input.accent_color||'emerald',default_theme:input.default_theme||'light',logo_url:input.logo_url||null,
    iva_rate:0.16,timezone:'America/Mexico_City',active:false,provisioning_state:'pending',provisioning_plan:plan,
    features:JSON.stringify({...DEFAULT_FEATURES,...preset?.features}),mesas:plan.mesas,
    ...(input.vertical?{type:input.vertical}:{}),
    ...(preset?{pos_settings:{'agents.thresholds':{...preset.thresholds,source:`vertical:${preset.id}`,seeded_at:new Date().toISOString()}}}:{}),
    data_source:'fullsite',business_day_start_local:'05:00:00'}])
  // A concurrent first request may have won. Only its committed plan is authoritative.
  const tenant=await readTenant(input.clientId)
  if(!tenant)throw new Error('[provision] tenant insert unconfirmed')
  return {clientId:input.clientId,created,tenant}
}
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!SB_URL || !serviceKey()) throw new Error('[provision] service configuration required')
  const response = await checked(await fetch(`${SB_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(args),cache:'no-store'}),name)
  return response.json()
}
export interface ProvisionActivation { activated:boolean; provisioning_state:'pending'|'complete'|null; active:boolean; staff_setup_required:boolean }
/** Memberships and activation commit together. A suspended/legacy tenant is never reactivated. */
export async function activateProvisionedTenant(clientId:string,ownerUserId:string,options:{serviceUserId?:string}={}): Promise<ProvisionActivation> {
  const result = await rpc('pos_activate_provisioned_tenant',{p_client_id:clientId,p_owner_user_id:ownerUserId,p_service_user_id:options.serviceUserId||null}) as ProvisionActivation
  if (!result || typeof result.activated !== 'boolean' || typeof result.active !== 'boolean' || typeof result.staff_setup_required !== 'boolean' || ![null,'pending','complete'].includes(result.provisioning_state)) throw new Error('[provision] invalid activation receipt')
  return result
}

/**
 * Provision a full tenant skeleton. Fail-closed: throws if no service key.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  validateInput(input)
  const { clientId } = input
  const begun=await provisionTenantBegin(input)
  if(begun.tenant.provisioning_state!=='pending') {
    const readiness=await rpc('pos_mark_tenant_provisioned',{p_client_id:clientId}) as {ready?:boolean}
    if(readiness?.ready!==true)throw new Error('[provision] readiness unconfirmed')
    return {clientId,staffPins:[],created:{clients:0,client_locations:0,pos_menu_categories:0,pos_menu_items:0,pos_payment_methods:0,pos_staff:0,pos_mesas:0,pos_combos:0,pos_mutation_authority:0,pos_item_inventory_policy:0}}
  }
  const plan=requirePlan(begun.tenant.provisioning_plan),tpl=plan.template,mesas=plan.mesas,clientsCount=begun.created
  const locationRows=plan.locations.map(location=>({...location,client_id:clientId,active:true}))
  const locationsCount = await upsert('client_locations', locationRows)

  // ── 3. menu categories + items ─────────────────────────────────────────────
  const catRows = tpl.menu.map(cat => ({
    id: `${clientId}-${cat.idSuffix}`,
    client_id: clientId,
    name: cat.name,
    color: cat.color,
    sort_order: cat.sort_order,
    active: true,
  }))
  const catsCount = await upsert('pos_menu_categories', catRows)

  const itemRows = tpl.menu.flatMap(cat =>
    cat.items.map(item => ({
      id: `${clientId}-${item.idSuffix}`,
      client_id: clientId,
      category_id: `${clientId}-${cat.idSuffix}`,
      name: item.name,
      price: item.price,
      sort_order: item.sort_order,
      active: true,
    }))
  )
  const itemsCount = await upsert('pos_menu_items', itemRows)

  // ── 4. payment methods ─────────────────────────────────────────────────────
  const pmRows = tpl.paymentMethods.map((pm, i) => ({
    id: `${clientId}-pm-${i}`,
    client_id: clientId,
    name: pm.name,
    type: pm.type,
    commission_pct: pm.commission_pct,
    fiscal_code: pm.fiscal_code || '',
    active: true,
  }))
  const pmCount = await upsert('pos_payment_methods', pmRows)

  // ── 5. role placeholders (pos_staff) ───────────────────────────────────────
  // One placeholder staff row per role so the new tenant has a starting role set.
  // PINs de 10 dígitos (regla 2026-08-29: la huella es el método primario; el
  // PIN es respaldo y debe ser largo, no un 4 dígitos observable). Aleatorios
  // e INACTIVOS: el alta real de empleados/enrolamiento habilita acceso, y
  // sembrados SOLO si el tenant no tiene staff (idempotente por conteo — así un
  // re-provision de un tenant viejo con PINs de 4 dígitos no duplica filas).
  let staffCount = 0
  const staffPins: Array<{ role: string; pin: string }> = []
  if ((await countFor('pos_staff', clientId)) === 0) {
    const staffRows = tpl.roles.map((role) => {
      const pin = randomPin10()
      staffPins.push({ role, pin })
      return {
        id: `${clientId}-staff-${role}`,
        client_id: clientId,
        name: `${role} (plantilla)`,
        pin,
        role,
        role_display: role,
        active: false,
        hourly_rate: 0,
        weekly_salary: 0,
      }
    })
    const inserted = await insertMissing('pos_staff', staffRows)
    staffCount = inserted.length
    // Only inserted inactive placeholders return their credential; a racing
    // retry must not present a freshly generated PIN that was never stored.
    staffPins.splice(0, staffPins.length, ...inserted.map(row => ({role:String(row.role),pin:String(row.pin)})))
  }

  // ── 5b. combos semilla (pos_combos) ────────────────────────────────────────
  // Sin esto, el speed screen de un tenant counter nace vacío (gap Minute-0 #12
  // — visto en campo con carls-jr, cuyos combos se sembraron a mano el
  // 2026-08-29; este bloque hace lo mismo para todo tenant nuevo). Idempotente
  // por conteo: un re-provision no duplica ni pisa combos editados.
  let combosCount = 0
  if (plan.combos.length && (await countFor('pos_combos', clientId)) === 0) {
    const comboRows = plan.combos.map(c => ({
      id: `${clientId}-${c.idSuffix}`,
      client_id: clientId,
      name: c.name,
      price: c.price,
      items: c.items.map(it => ({
        menu_item_id: `${clientId}-${it.itemIdSuffix}`,
        name: it.name,
        substitutions: (it.substitutions || []).map(s => ({ id: `${clientId}-${s.itemIdSuffix}`, name: s.name })),
      })),
      upsell: c.upsell || null,
      active: true,
      schedule: null,
    }))
    combosCount = await upsert('pos_combos', comboRows)
  }

  // ── 6. mesas (floor plan) ──────────────────────────────────────────────────
  // Sin esto el POS del tenant nuevo abre con plano vacío (no se puede sentar
  // ni cobrar en mesa). Se siembra SOLO si el tenant aún no tiene mesas
  // (idempotente por conteo, ya que pos_mesas.id es uuid autogenerado).
  let mesasCount = 0
  if (mesas > 0 && (await countFor('pos_mesas', clientId)) === 0) {
    const PER_ROW = 5
    const mesaRows = Array.from({ length: mesas }, (_, i) => {
      const n = i + 1
      const col = i % PER_ROW
      const row = Math.floor(i / PER_ROW)
      return {
        client_id: clientId,
        number: n,
        capacity: 4,
        zone: 'Principal',
        x_pct: Math.min(92, 10 + col * 19),
        y_pct: Math.min(88, 14 + row * 20),
        shape: n % 3 === 0 ? 'round' : 'square',
        sort_order: n,
        active: true,
      }
    })
    mesasCount = await insertRows('pos_mesas', mesaRows)
  }

  // ── 7. inventory deduction gates (SKEL04 · A1) ─────────────────────────────
  // Sin estos dos gates la deducción de stock NUNCA corre para un tenant nuevo
  // (r1_reconcile_item, 004_functions.sql):
  //   • pos_mutation_authority.sale_authority DEBE ser 'r1'. Sin fila el default
  //     es 'legacy' → cada item cae en BLOCKED_OWNER_MISSING.
  //   • pos_item_inventory_policy DEBE existir por menu_item con inventory_mode
  //     != 'unclassified'. Sin fila → BLOCKED_UNCLASSIFIED.
  // Default por item = 'non_inventory': la venta reconcilia limpio
  // (NO_MUTATION_APPROVED) SIN descontar, hasta que el cliente capture una receta
  // (que flipa la policy del item a 'recipe' — ver setItemRecipe en pos-data).
  // Así nunca se bloquea la venta ni se "miente" descontando algo que no existe.
  const nowIso = new Date().toISOString()

  const authorityCount = await upsert('pos_mutation_authority', [{
    client_id: clientId,
    sale_authority: 'r1',
    cutover_at: nowIso,
    cutover_by: 'provision',
  }])

  const policyRows = itemRows.map(it => ({
    client_id: clientId,
    menu_item_id: it.id,
    inventory_mode: 'non_inventory',
    approved_at: nowIso,
    approved_by: 'provision',
  }))
  const policyCount = await upsertOnConflict(
    'pos_item_inventory_policy', policyRows, 'client_id,menu_item_id'
  )

  const readiness = await rpc('pos_mark_tenant_provisioned', {p_client_id:clientId}) as {ready?:boolean}
  if (readiness?.ready !== true) throw new Error('[provision] readiness unconfirmed')

  return {
    clientId,
    created: {
      clients: clientsCount,
      client_locations: locationsCount,
      pos_menu_categories: catsCount,
      pos_menu_items: itemsCount,
      pos_payment_methods: pmCount,
      pos_staff: staffCount,
      pos_mesas: mesasCount,
      pos_combos: combosCount,
      pos_mutation_authority: authorityCount,
      pos_item_inventory_policy: policyCount,
    },
    staffPins,
  }
}
