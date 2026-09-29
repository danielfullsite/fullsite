// Food cost data — server-side con service key.
// wansoft_recipes / wansoft_menu_config / wansoft_data tienen RLS sin policy
// anon SELECT (los costos son sensibles y no deben viajar con la anon key),
// por eso este route las lee con la service key y la página consume esto.

import { withPOSAuth } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    const opts = { headers, cache: 'no-store' as const }
    const clientId = auth.clientId

    // FULLSITE PRIMERO: food cost desde las fichas técnicas de Fullsite (fs_food_cost).
    // Las fuentes legacy (wansoft_recipes / costeo Excel) quedan sólo como respaldo.
    const fsFoodCostP = fetch(`${sbUrl}/rest/v1/rpc/fs_food_cost`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: clientId }), cache: 'no-store',
    })
    const [recipesRes, menuRes, posRecipesRes, menuConfigRes, costeoRes, modsRes, invRes, yieldRes] = await Promise.all([
      fetch(`${sbUrl}/rest/v1/wansoft_recipes?client_id=eq.${clientId}&select=saucer_id,saucer_name,budget_cost,ingredients`, opts),
      fetch(`${sbUrl}/rest/v1/pos_menu_items?client_id=eq.${clientId}&select=name,price,category_id`, opts),
      fetch(`${sbUrl}/rest/v1/pos_recipes?client_id=eq.${clientId}&select=nombre,precio_venta,costo_total,pct_costo,ingredientes&precio_venta=gt.0`, opts),
      fetch(`${sbUrl}/rest/v1/wansoft_menu_config?client_id=eq.${clientId}&select=fecha,saucers&order=fecha.desc&limit=10`, opts),
      fetch(`${sbUrl}/rest/v1/wansoft_data?tipo=eq.costeo_por_platillo&client_id=eq.${clientId}&order=fecha.desc&limit=1&select=data,fecha`, opts),
      fetch(`${sbUrl}/rest/v1/pos_modifiers?client_id=eq.${clientId}&id=like.wsm-*&select=name,price`, opts),
      fetch(`${sbUrl}/rest/v1/pos_inventory_products?client_id=eq.${clientId}&active=eq.true&select=name,unit,cost_per_unit,stock,category`, opts),
      fetch(`${sbUrl}/rest/v1/pos_yield_studies?client_id=eq.${clientId}&select=slug,label,unit_label,inputs,outputs&order=created_at.asc`, opts),
    ])

    const fsRes = await fsFoodCostP.catch(() => null)
    return Response.json({
      // null = la lectura falló (distinto de "no hay fichas técnicas").
      fsFoodCost: fsRes && fsRes.ok ? await fsRes.json() : null,
      recipes: recipesRes.ok ? await recipesRes.json() : [],
      menuItems: menuRes.ok ? await menuRes.json() : [],
      posRecipes: posRecipesRes.ok ? await posRecipesRes.json() : [],
      menuConfig: menuConfigRes.ok ? await menuConfigRes.json() : [],
      costeo: costeoRes.ok ? await costeoRes.json() : [],
      posModifiers: modsRes.ok ? await modsRes.json() : [],
      inventoryProducts: invRes.ok ? await invRes.json() : [],
      yieldStudies: yieldRes.ok ? await yieldRes.json() : [],
    })
  } catch {
    return Response.json({ recipes: [], menuItems: [], posRecipes: [], menuConfig: [], costeo: [], posModifiers: [], yieldStudies: [] })
  }
}
