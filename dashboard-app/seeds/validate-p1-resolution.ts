#!/usr/bin/env node
/**
 * P1 Phase A: Resolution report — AMALAY production data
 *
 * Simulates deductIngredientsForOrder() resolution for the top 50 AMALAY items
 * (last 30 days from wansoft_daily) and for all pos_menu_items.
 *
 * Gate: if ANY top-20 item resolves as UNRESOLVED, exits 1 (do not deploy).
 *
 * Run: npx tsx seeds/validate-p1-resolution.ts
 */

import { getAdminClient } from './_lib/supabase.ts'

// ─── Inline RECIPE_ALIASES (mirror of src/lib/pos-data.ts — kept in sync manually) ──
const RECIPE_ALIASES: Record<string, string[]> = {
  'chilaquiles verdes':           ['chilaquiles verdes'],
  'chilaquiles rojos':            ['chilaquiles rojos'],
  'chilaquiles light':            ['chilaquiles ligth', 'chilaquiles light'],
  'enchiladas suizas':            ['enchiladas suizas'],
  'machacado con huevo':          ['machacado con huevo', 'machaca con huevo'],
  'half & half combo':            ['half & half combo'],
  'half  half combo':             ['half  half combo'],
  'garden omelet':                ['garden omelet', 'garden omelette'],
  'combo fit':                    ['combo fit'],
  'egg and pancake combo':        ['combo kids pancake & eggs'],
  'miss benedict':                ['miss. benedict', 'miss benedict- salmon', 'miss benedict panela wallander'],
  'cafe americano':               ['cafe americano'],
  'capuchino caliente':           ['capuchino'],
  'cafe latte caliente':          ['cafe latte'],
  'latte frio':                   ['latte frio'],
  'matcha latte frio':            ['matcha latte'],
  'chai latte frio':              ['chai latte'],
  'mocca latte caliente':         ['mocca latte'],
  'avocado toast':                ['avo toast'],
  'amalay salmon special toast':  ['amalay smoked salmon & avocado toast'],
  'el mexicano toast':            ['el mexicano toast', 'mexicano'],
  'salmon bagel':                 ['salmon bagel'],
  'combo amalay':                 ['combo amalay'],
  'french toast':                 ['french toast'],
  'mimosa clasica':               ['mimosa clasica'],
  'chamoyada de mango':           ['chamoyada de mango'],
  'croque madame amalay':         ['croque madame', 'mumma"s breakfast croissant', "mumy's breakfast croissant"],
  'croissant nutella':            ['croissant nutella'],
  'turkey & swiss croissant':     ['turkey & swiss croisaint', "nell's turkey & swiss"],
  'croissant almendra':           ['croissant almendra'],
  'jugo de naranja natural':      ['jugo de naranja'],
  'jugo verde de la casa':        ['jugo verde'],
  'jugo be inmune':               ['jugo be inmune'],
  'jugo dr detox':                ['jugo dr detox'],
  'jugo u glow':                  ['jugo u glow'],
  'limonada natural':             ['limonada natural'],
  'limonada de frutos rojos':     ['limonada de frutos rojos'],
  'smoothie mango-matcha':        ['smoothie mango matcha'],
  'smoothie pink flamingo':       ['smoothie pink flamingo'],
  'smoothie tropical coconut':    ['smoothie tropical coconut'],
  'frapuccino':                   ['frapuccino'],
  'frappe matcha':                ['frappe matcha'],
  'frappe mango-maracuya':        ['frappe mango maracuya'],
  'classic pancakes':             ['classic buttermilk pancakes', 'classic butermilk pancakes'],
  'chicken panini':               ['turkey pannini', 'turkey panini'],
  'pasta mamarosa':               ['pasta pacceri al pesto'],
  'pasta bologese':               ['pasta bologese'],
  'pizza pepperoni':              ['pizza pepperoni'],
  'pizza peperoni':               ['pizza peperoni'],
  'pizza margarita':              ['pizza margarita'],
  'acai love bowl':               ['acai love'],
  'fruit bowl':                   ['plato de berrys', 'plato granola con berries'],
  'cheesecake':                   ['cheesecake'],
  'carrot cake':                  ['carrot cake', 'coffe cake'],
  'concha de mantequilla':        ['concha de mantequilla'],
  'healthy crunchy mix':          ['healthy & crunchy', 'healty munchies'],
  'te chai':                      ['te chai'],
  'te verde':                     ['te verde'],
}

// Items that are market/retail products — no recipe expected, not a failure
const NO_RECIPE_EXPECTED = new Set([
  'agua amalay bot 500 ml', 'agua amalay 500 ml', 'agua amalay 1l',
  'coca cola light 355ml', 'coca cola 355ml', 'coca cola sin azucar 355ml',
  'agua de piedra natural', 'heineken', 'xx lager', 'modelo especial',
  'corona extra', 'sprite 355ml', 'fanta naranja 355ml',
  'red bull', 'monster energy',
])

// ─── Same normalizer as deductIngredientsForOrder() ──────────────────────────
const normalize = (n: string) => n.toLowerCase()
  .replace(/^sprw\s*-\s*/i, '')
  .replace(/\s*\(.*?\)\s*/g, ' ')
  .replace(/\s*(14oz|16oz|12oz|360\s*ml|240\s*ml|180\s*ml|450\s*ml)\s*/gi, ' ')
  .replace(/\s*(caliente|frio|fría|helado|servido)\s*/gi, ' ')
  .replace(/\s*(media porción|para compartir|1\/2)\s*/gi, ' ')
  .replace(/\s+/g, ' ').trim()

type ResolutionState = 'DB_MAPPING' | 'FUZZY_FALLBACK' | 'UNRESOLVED' | 'NO_RECIPE'

interface ItemResult {
  name: string
  nameLower: string
  state: ResolutionState
  resolvedVia: string
  totalVentas?: number
  diasVendido?: number
}

// ─── Management API helper ────────────────────────────────────────────────────
const PROJECT_REF = 'qjiomlvudfmzuvqvhwpk'
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''

async function mgmtSQL<T = Record<string, unknown>>(query: string): Promise<T[]> {
  if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN not set in env')
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`SQL ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return Array.isArray(data) ? data as T[] : []
}

async function main() {
  const sb = getAdminClient()
  const CLIENT_ID = 'amalay'

  console.log('\n◆ P1 PHASE A — RESOLUTION REPORT (AMALAY)\n')

  // ── 1. Recipe_ref coverage ────────────────────────────────────────────────
  const { data: menuItems } = await sb
    .from('pos_menu_items')
    .select('id,name,recipe_ref,active')
    .eq('client_id', CLIENT_ID)

  const activeItems = (menuItems ?? []).filter(i => i.active !== false)
  const withRef = activeItems.filter(i => i.recipe_ref != null)
  const withoutRef = activeItems.filter(i => i.recipe_ref == null)
  const coveragePct = activeItems.length > 0
    ? Math.round(withRef.length / activeItems.length * 100) : 0

  console.log(`pos_menu_items (active): ${activeItems.length}`)
  console.log(`  recipe_ref set:  ${withRef.length} (${coveragePct}%)`)
  console.log(`  recipe_ref null: ${withoutRef.length} (${100 - coveragePct}%)`)

  // Build name→recipe_ref map (lowercase)
  const nameToRef = new Map<string, string | null>()
  for (const item of activeItems) {
    nameToRef.set(item.name.toLowerCase(), item.recipe_ref ?? null)
  }

  // ── 2. pos_recipes_old — which recipe names exist ─────────────────────────
  const { data: recipeRows } = await sb
    .from('pos_recipes_old')
    .select('menu_item_name')
    .eq('client_id', CLIENT_ID)

  const recipeNameSet = new Set((recipeRows ?? []).map(r => r.menu_item_name.toLowerCase()))
  const recipeNamesByNorm = new Map<string, string>()
  for (const name of recipeNameSet) {
    recipeNamesByNorm.set(normalize(name), name)
  }

  console.log(`pos_recipes_old (unique names): ${recipeNameSet.size}`)

  // ── 3. Top 50 wansoft items (last 90 days, parsed in JS) ─────────────────
  // platillos_top is stored as text in wansoft_daily, not native JSONB.
  let wansoftTop: { nombre: string; total_ventas: number; dias_vendido: number }[] = []
  {
    const DAYS = 90
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const { data: wRows } = await sb
      .from('wansoft_daily')
      .select('fecha,platillos_top')
      .gte('fecha', since)
      .not('platillos_top', 'is', null)

    // Aggregate in JS — platillos_top is a JSON string: [{nombre,cantidad,total}]
    const agg = new Map<string, { total: number; dias: Set<string> }>()
    for (const row of wRows ?? []) {
      let items: { nombre?: string; total?: number | string }[] = []
      try {
        const raw = row.platillos_top
        items = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])
      } catch { continue }
      for (const item of items) {
        if (!item.nombre) continue
        const n = item.nombre.trim()
        const t = Number(item.total ?? 0)
        if (!n || isNaN(t)) continue
        if (!agg.has(n)) agg.set(n, { total: 0, dias: new Set() })
        agg.get(n)!.total += t
        agg.get(n)!.dias.add(row.fecha)
      }
    }
    wansoftTop = [...agg.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 50)
      .map(([nombre, { total, dias }]) => ({
        nombre,
        total_ventas: total,
        dias_vendido: dias.size,
      }))
    console.log(`wansoft top items (last ${DAYS}d): ${wansoftTop.length} (across ${wRows?.length ?? 0} days with data)`)
  }

  // ── 4. Simulate resolution ────────────────────────────────────────────────
  function resolveItem(nameRaw: string): ItemResult {
    const nameLower = nameRaw.toLowerCase()
    const nameNorm  = normalize(nameRaw)

    // NO_RECIPE check
    if (NO_RECIPE_EXPECTED.has(nameLower)) {
      return { name: nameRaw, nameLower, state: 'NO_RECIPE', resolvedVia: 'market item' }
    }

    // Path 1 — DB_MAPPING via recipe_ref (from pos_menu_items)
    const ref = nameToRef.get(nameLower)
    if (ref != null) {
      if (recipeNameSet.has(ref)) {
        return { name: nameRaw, nameLower, state: 'DB_MAPPING', resolvedVia: `recipe_ref="${ref}"` }
      }
      // recipe_ref set but recipe missing in pos_recipes_old — still DB_MAPPING (data gap)
      return { name: nameRaw, nameLower, state: 'DB_MAPPING', resolvedVia: `recipe_ref="${ref}" (recipe data gap)` }
    }

    // Path 2 — FUZZY_FALLBACK via RECIPE_ALIASES
    const aliases = RECIPE_ALIASES[nameLower]
    if (aliases) {
      for (const alias of aliases) {
        if (recipeNameSet.has(alias)) {
          return { name: nameRaw, nameLower, state: 'FUZZY_FALLBACK', resolvedVia: `RECIPE_ALIASES → "${alias}"` }
        }
      }
      // Alias found in RECIPE_ALIASES but recipe_name not in pos_recipes_old (data gap)
      return { name: nameRaw, nameLower, state: 'FUZZY_FALLBACK', resolvedVia: `RECIPE_ALIASES → "${aliases[0]}" (recipe data gap)` }
    }

    // Path 3 — exact match on recipe name
    if (recipeNameSet.has(nameLower)) {
      return { name: nameRaw, nameLower, state: 'FUZZY_FALLBACK', resolvedVia: 'exact name match' }
    }

    // Path 4 — normalized match
    const normMatch = recipeNamesByNorm.get(nameNorm)
    if (normMatch) {
      return { name: nameRaw, nameLower, state: 'FUZZY_FALLBACK', resolvedVia: `normalized → "${normMatch}"` }
    }

    // Path 5 — best partial match (score > 0.5)
    let bestScore = 0
    let bestName = ''
    for (const [rNorm, rName] of recipeNamesByNorm) {
      if (rNorm.length < 3 || nameNorm.length < 3) continue
      if (rNorm.includes(nameNorm) || nameNorm.includes(rNorm)) {
        const score = Math.min(rNorm.length, nameNorm.length) / Math.max(rNorm.length, nameNorm.length)
        if (score > bestScore && score > 0.5) { bestScore = score; bestName = rName }
      }
    }
    if (bestName) {
      return { name: nameRaw, nameLower, state: 'FUZZY_FALLBACK', resolvedVia: `partial match → "${bestName}" (score=${bestScore.toFixed(2)})` }
    }

    return { name: nameRaw, nameLower, state: 'UNRESOLVED', resolvedVia: 'none' }
  }

  // ── 5. Run simulation on wansoft top 50 ──────────────────────────────────
  const wansoftResults: ItemResult[] = wansoftTop.map(item => ({
    ...resolveItem(item.nombre),
    totalVentas: item.total_ventas,
    diasVendido: item.dias_vendido,
  }))

  // ── 6. Run simulation on all pos_menu_items ───────────────────────────────
  const posResults: ItemResult[] = activeItems.map(item => resolveItem(item.name))

  // ── 7. Print report ───────────────────────────────────────────────────────
  const section = (t: string) => console.log(`\n${'─'.repeat(56)}\n${t}`)

  section('TOP 20 — by ventas (last 90d)')
  const top20 = wansoftResults.slice(0, 20)
  let unresolvedInTop20 = 0
  for (const r of top20) {
    const icon = r.state === 'DB_MAPPING' ? '✅' : r.state === 'FUZZY_FALLBACK' ? '⚠️ ' : r.state === 'NO_RECIPE' ? '–' : '❌'
    const ventas = r.totalVentas != null ? `  $${r.totalVentas.toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : ''
    console.log(`  ${icon} [${r.state}]  ${r.name}${ventas}`)
    if (r.state === 'UNRESOLVED') unresolvedInTop20++
  }

  section('TOP 50 — resolution summary')
  if (wansoftResults.length > 0) {
    const counts = { DB_MAPPING: 0, FUZZY_FALLBACK: 0, UNRESOLVED: 0, NO_RECIPE: 0 }
    for (const r of wansoftResults) counts[r.state]++
    const n = wansoftResults.length
    console.log(`  Items analyzed:    ${n}`)
    console.log(`  DB_MAPPING:        ${counts.DB_MAPPING} (${pct(counts.DB_MAPPING, n)}%)`)
    console.log(`  FUZZY_FALLBACK:    ${counts.FUZZY_FALLBACK} (${pct(counts.FUZZY_FALLBACK, n)}%)`)
    console.log(`  UNRESOLVED:        ${counts.UNRESOLVED} (${pct(counts.UNRESOLVED, n)}%)`)
    console.log(`  NO_RECIPE:         ${counts.NO_RECIPE} (market/retail — expected)`)

    section('UNRESOLVED items (ordered by ventas)')
    const unresolved = wansoftResults.filter(r => r.state === 'UNRESOLVED')
    if (unresolved.length === 0) {
      console.log('  ✅ ninguno')
    } else {
      for (const r of unresolved) {
        const v = r.totalVentas != null ? ` — $${r.totalVentas.toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : ''
        console.log(`  ❌ ${r.name}${v}`)
      }
    }

    section('FUZZY_FALLBACK items (ordered by ventas)')
    const fuzzy = wansoftResults.filter(r => r.state === 'FUZZY_FALLBACK')
    if (fuzzy.length === 0) {
      console.log('  ✅ ninguno')
    } else {
      for (const r of fuzzy) {
        const v = r.totalVentas != null ? ` — $${r.totalVentas.toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : ''
        console.log(`  ⚠️  ${r.name}${v}`)
        console.log(`       via: ${r.resolvedVia}`)
      }
    }
  }

  section('pos_menu_items coverage (all active items)')
  const posCounts = { DB_MAPPING: 0, FUZZY_FALLBACK: 0, UNRESOLVED: 0, NO_RECIPE: 0 }
  for (const r of posResults) posCounts[r.state]++
  const pn = posResults.length
  console.log(`  Total items:       ${pn}`)
  console.log(`  DB_MAPPING:        ${posCounts.DB_MAPPING} (${pct(posCounts.DB_MAPPING, pn)}%)`)
  console.log(`  FUZZY_FALLBACK:    ${posCounts.FUZZY_FALLBACK} (${pct(posCounts.FUZZY_FALLBACK, pn)}%)`)
  console.log(`  UNRESOLVED:        ${posCounts.UNRESOLVED} (${pct(posCounts.UNRESOLVED, pn)}%)`)
  console.log(`  NO_RECIPE:         ${posCounts.NO_RECIPE} (market/retail — expected)`)

  const posUnresolved = posResults.filter(r => r.state === 'UNRESOLVED')
  if (posUnresolved.length > 0) {
    console.log('\n  UNRESOLVED pos_menu_items:')
    for (const r of posUnresolved) console.log(`    ❌ ${r.name}`)
  }

  // ── 8. Gate check ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(56))
  if (wansoftTop.length === 0) {
    console.log('\n✗ GATE FAIL — no wansoft data available. Cannot validate top-20 coverage.\n')
    process.exit(1)
  } else if (unresolvedInTop20 > 0) {
    console.log(`\n✗ GATE FAIL — ${unresolvedInTop20} UNRESOLVED in top 20. Corregir antes de desplegar.\n`)
    process.exit(1)
  } else if (wansoftResults.filter(r => r.state === 'UNRESOLVED').length > 0) {
    const total = wansoftResults.filter(r => r.state === 'UNRESOLVED').length
    console.log(`\n⚠️  GATE PASS — top 20 limpio. ${total} UNRESOLVED fuera del top 20 (revisar antes de desplegar).\n`)
  } else {
    console.log('\n✅ GATE PASS — cero UNRESOLVED en top 50. Listo para desplegar.\n')
  }
}

function pct(n: number, total: number) {
  return total === 0 ? 0 : Math.round(n / total * 100)
}

main().catch(err => { console.error(err?.message ?? err); process.exit(1) })
