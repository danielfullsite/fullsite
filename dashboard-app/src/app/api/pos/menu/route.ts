// GET /api/pos/menu — catálogo completo del tenant (menú, modificadores, formas
// de pago) leído server-side con service key. Autoriza con el shift token del POS.
//
// Por qué existe: desde la red del restaurante, los clientes que no son navegador
// (el local-server node, PowerShell) los bloquea Cloudflare (fingerprint TLS) y
// varias tablas (pos_menu_categories, pos_payment_methods) exigen sesión
// autenticada (RLS). El POS kiosk no tiene sesión Supabase. Este endpoint corre
// en Vercel (que sí alcanza Supabase) y devuelve el catálogo ya ensamblado.
// El Offline Shell lo llama online y cachea a IndexedDB para operar offline.

import { NextResponse, NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sb(query: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`${query.split('?')[0]} → ${res.status}`)
  return res.json()
}

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const cid = encodeURIComponent(auth.clientId)

  try {
    const [cats, items, mgroups, mods, itemLinks, catLinks, methods] = await Promise.all([
      sb(`pos_menu_categories?client_id=eq.${cid}&active=eq.true&order=sort_order.asc&select=id,name,color,sort_order`),
      sb(`pos_menu_items?client_id=eq.${cid}&active=eq.true&order=sort_order.asc&select=id,category_id,name,price,barcode,sort_order`),
      sb(`pos_modifier_groups?client_id=eq.${cid}&active=eq.true&select=id,name,level,min_selections,max_selections,required,sort_order`),
      sb(`pos_modifiers?client_id=eq.${cid}&active=eq.true&select=id,group_id,name,price,sort_order`),
      sb(`pos_item_modifier_groups?client_id=eq.${cid}&select=item_id,group_id`),
      sb(`pos_category_modifiers?client_id=eq.${cid}&select=category_id,modifier_group_id`),
      sb(`pos_payment_methods?client_id=eq.${cid}&active=eq.true&order=name.asc&select=id,name,type,commission_pct`),
    ])

    const itemsByCat = new Map<string, unknown[]>()
    for (const it of items as { id: string; category_id: string; name: string; price: number; barcode: string | null }[]) {
      const arr = itemsByCat.get(it.category_id) || []
      arr.push({ id: it.id, name: it.name, price: Number(it.price), barcode: it.barcode })
      itemsByCat.set(it.category_id, arr)
    }
    const categories = (cats as { id: string; name: string; color: string }[]).map((c) => ({
      id: c.id, name: c.name, color: c.color, items: itemsByCat.get(c.id) || [],
    }))

    return NextResponse.json({
      restaurant_id: auth.clientId,
      refreshed_at: new Date().toISOString(),
      categories,
      modifiers: { groups: mgroups, mods, item_links: itemLinks, category_links: catLinks },
      payment_methods: methods,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
