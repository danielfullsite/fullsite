// Food cost data — server-side con service key.
// wansoft_recipes / wansoft_menu_config / wansoft_data tienen RLS sin policy
// anon SELECT (los costos son sensibles y no deben viajar con la anon key),
// por eso este route las lee con la service key y la página consume esto.

export async function GET() {
  try {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    const opts = { headers, cache: 'no-store' as const }

    const [recipesRes, menuRes, posRecipesRes, menuConfigRes, costeoRes, modsRes, invRes] = await Promise.all([
      fetch(`${sbUrl}/rest/v1/wansoft_recipes?client_id=eq.amalay&select=saucer_id,saucer_name,budget_cost,ingredients`, opts),
      fetch(`${sbUrl}/rest/v1/pos_menu_items?client_id=eq.amalay&select=name,price,category_id`, opts),
      fetch(`${sbUrl}/rest/v1/pos_recipes?select=nombre,precio_venta&precio_venta=gt.0`, opts),
      fetch(`${sbUrl}/rest/v1/wansoft_menu_config?client_id=eq.amalay&select=fecha,saucers&order=fecha.desc&limit=10`, opts),
      fetch(`${sbUrl}/rest/v1/wansoft_data?tipo=eq.costeo_por_platillo&order=fecha.desc&limit=1&select=data,fecha`, opts),
      // Modificadores reales de Wansoft (wsm-*) — para costear recetas huérfanas
      // (EXT. POLLO, C/ PAN BRIOCHE...) contra su precio extra
      fetch(`${sbUrl}/rest/v1/pos_modifiers?client_id=eq.amalay&id=like.wsm-*&select=name,price`, opts),
      // Current ingredient costs from pos_inventory_products (769 products with real stock)
      fetch(`${sbUrl}/rest/v1/pos_inventory_products?active=eq.true&select=name,unit,cost_per_unit,stock,category`, opts),
    ])

    return Response.json({
      recipes: recipesRes.ok ? await recipesRes.json() : [],
      menuItems: menuRes.ok ? await menuRes.json() : [],
      posRecipes: posRecipesRes.ok ? await posRecipesRes.json() : [],
      menuConfig: menuConfigRes.ok ? await menuConfigRes.json() : [],
      costeo: costeoRes.ok ? await costeoRes.json() : [],
      posModifiers: modsRes.ok ? await modsRes.json() : [],
      inventoryProducts: invRes.ok ? await invRes.json() : [],
    })
  } catch {
    return Response.json({ recipes: [], menuItems: [], posRecipes: [], menuConfig: [], costeo: [], posModifiers: [] })
  }
}
