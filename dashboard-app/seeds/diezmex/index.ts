import { getAdminClient } from '../_lib/supabase.ts'
import { seedRestaurant } from '../_lib/seed-restaurant.ts'
import { config } from './config.ts'

const CLIENT = 'diezmex-demo'

export async function seed() {
  const sb = getAdminClient()

  // Reemplaza únicamente la historia sintética de este tenant para que el seed
  // sea repetible. La cuenta Auth y su membresía no se tocan.
  // Orden dependiente → padre para respetar llaves foráneas.
  for (const table of [
    'pos_orders', 'pos_turnos', 'pos_item_inventory_policy',
    'pos_item_modifier_groups', 'pos_modifiers', 'pos_modifier_groups',
    'pos_menu_items', 'pos_menu_categories',
    'pos_payment_methods', 'pos_staff',
  ]) {
    const { error } = await sb.from(table).delete().eq('client_id', CLIENT)
    if (error) throw new Error(`[${table}] cleanup: ${error.message}`)
  }
  await seedRestaurant(sb, config)

  await sb.from('client_locations').delete().eq('id', 'diezmex-demo-principal').eq('client_id', CLIENT)

  const brands = [
    ['diezmex-rosta', 'Rosta'],
    ['diezmex-macadam', 'Café Macadam'],
    ['diezmex-manteca', 'Tacos Manteca'],
    ['diezmex-atletico', 'Atletico Cafe'],
    ['diezmex-casa-oso', 'Casa Oso'],
  ] as const
  let error = (await sb.from('client_locations').upsert(brands.map(([id, name]) => ({
    id, client_id: CLIENT, name, address: 'Monterrey, Nuevo León', active: true,
  })), { onConflict: 'id' })).error
  if (error) throw new Error(`[locations] ${error.message}`)

  // Reparto determinista de la historia sintética entre las cinco marcas.
  const seededOrders: Array<{ id: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data: page, error: orderReadError } = await sb.from('pos_orders')
      .select('id').eq('client_id', CLIENT).order('created_at', { ascending: true }).range(from, from + 999)
    if (orderReadError) throw new Error(`[orders read] ${orderReadError.message}`)
    seededOrders.push(...(page || []))
    if (!page || page.length < 1000) break
  }
  for (let brandIndex = 0; brandIndex < brands.length; brandIndex++) {
    const ids = seededOrders.filter((_, index) => index % brands.length === brandIndex).map(row => row.id)
    for (let offset = 0; offset < ids.length; offset += 150) {
      const batch = ids.slice(offset, offset + 150)
      const { error: updateError } = await sb.from('pos_orders').update({ location_id: brands[brandIndex][0] }).in('id', batch)
      if (updateError) throw new Error(`[orders location] ${updateError.message}`)
    }
  }

  const ingredients = [
    ['proteina-res', 'Proteína de res', 'kg', 198, 8, 4],
    ['aguacate', 'Aguacate', 'kg', 82, 12, 5],
    ['cafe', 'Café en grano', 'kg', 310, 6, 3],
    ['leche', 'Leche', 'l', 29, 22, 10],
    ['pan', 'Pan artesanal', 'pz', 18, 36, 16],
    ['salmon', 'Salmón', 'kg', 285, 7, 4],
  ] as const
  const ingredientRows = ingredients.map(([id, name, unit, cost]) => ({ id: `${CLIENT}-${id}`, client_id: CLIENT, name, unit, cost_per_unit: cost, category: 'Insumos demo', supplier: 'Proveedor Demo', yield_factor: 1, active: true }))
  error = (await sb.from('pos_ingredients').upsert(ingredientRows, { onConflict: 'id' })).error
  if (error) throw new Error(`[ingredients] ${error.message}`)

  const inventoryRows = ingredients.map(([id,,, , stock, reorder], index) => ({ id: -910001 - index, client_id: CLIENT, ingredient_id: `${CLIENT}-${id}`, stock, reorder_point: reorder, reorder_quantity: reorder * 2, stock_unit: id === 'pan' ? 'pz' : id === 'leche' ? 'l' : 'kg' }))
  error = (await sb.from('pos_inventory').delete().eq('client_id', CLIENT)).error
  if (error) throw new Error(`[inventory cleanup] ${error.message}`)
  error = (await sb.from('pos_inventory').insert(inventoryRows)).error
  if (error) throw new Error(`[inventory] ${error.message}`)

  error = (await sb.from('pos_recipes').delete().eq('client_id', CLIENT)).error
  if (error) throw new Error(`[recipes cleanup] ${error.message}`)
  error = (await sb.from('pos_recipes').insert([
    { id: -920001, client_id: CLIENT, nombre: 'Burger de la casa', precio_venta: 245, costo_total: 82.4, pct_costo: 33.6, source: 'demo', ingredientes: [{ nombre: 'Proteína de res', costo: 53 }, { nombre: 'Pan artesanal', costo: 18 }] },
    { id: -920002, client_id: CLIENT, nombre: 'Salmón al grill', precio_venta: 328, costo_total: 91.2, pct_costo: 27.8, source: 'demo', ingredientes: [{ nombre: 'Salmón', costo: 85.5 }] },
    { id: -920003, client_id: CLIENT, nombre: 'Avocado Toast', precio_venta: 158, costo_total: 48.7, pct_costo: 30.8, source: 'demo', ingredientes: [{ nombre: 'Aguacate', costo: 24.6 }, { nombre: 'Pan artesanal', costo: 18 }] },
  ])).error
  if (error) throw new Error(`[recipes] ${error.message}`)

  const today = new Date().toISOString().slice(0, 10)
  error = (await sb.from('agent_results').upsert([
    { id: -930001, client_id: CLIENT, agent_id: 'detective-costos', fecha: today, priority: 'high', summary: 'La Burger de la casa supera 3.6 puntos el objetivo de costo.', data: { synthetic: true, action: 'Revisar gramaje y merma de proteína', impact_mxn: 6840 } },
    { id: -930002, client_id: CLIENT, agent_id: 'predictor-demanda', fecha: today, priority: 'medium', summary: 'Se proyecta 18% más demanda entre 13:30 y 15:30.', data: { synthetic: true, forecast_orders: 146, confidence: 0.87 } },
    { id: -930003, client_id: CLIENT, agent_id: 'inventario-inteligente', fecha: today, priority: 'medium', summary: 'El café en grano llegará al punto de reorden en aproximadamente 2 días.', data: { synthetic: true, item: 'Café en grano', suggested_purchase: 8 } },
    { id: -930004, client_id: CLIENT, agent_id: 'coach-operativo', fecha: today, priority: 'info', summary: 'El tiempo promedio de cocina mejoró 11% durante la última semana.', data: { synthetic: true, avg_minutes: 8.7, previous_avg_minutes: 9.8 } },
  ], { onConflict: 'client_id,agent_id,fecha' })).error
  if (error) throw new Error(`[agent_results] ${error.message}`)
}
