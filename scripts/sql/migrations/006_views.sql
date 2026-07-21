-- ═══════════════════════════════════════════════════════════
-- FULLSITE VIEWS
-- Generated: 2026-07-21 from production
-- Views: 6
-- ═══════════════════════════════════════════════════════════

-- ── ops_daily_history ──
CREATE OR REPLACE VIEW ops_daily_history AS
 SELECT DISTINCT ON (client_id, fecha) id,
    client_id,
    fecha,
    record_type,
    bucket_start,
    ventas_dia,
    ventas_brutas,
    descuentos,
    devoluciones,
    efectivo,
    tarjeta,
    tickets_count,
    mesas_atendidas,
    personas_restaurant,
    ticket_promedio_restaurant,
    propinas_total,
    meseros,
    platillos_top,
    ventas_por_grupo,
    pago_metodos,
    source_system,
    generated_at,
    data_freshness,
    rows_aggregated
   FROM ops_daily
  WHERE (record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text]))
  ORDER BY client_id, fecha,
        CASE record_type
            WHEN 'cierre'::text THEN 1
            WHEN 'cierre_wansoft'::text THEN 2
            ELSE NULL::integer
        END;;

-- ── ops_daily_live ──
CREATE OR REPLACE VIEW ops_daily_live AS
 SELECT DISTINCT ON (client_id, fecha) id,
    client_id,
    fecha,
    record_type,
    bucket_start,
    ventas_dia,
    ventas_brutas,
    descuentos,
    devoluciones,
    efectivo,
    tarjeta,
    tickets_count,
    mesas_atendidas,
    personas_restaurant,
    ticket_promedio_restaurant,
    propinas_total,
    meseros,
    platillos_top,
    ventas_por_grupo,
    pago_metodos,
    source_system,
    generated_at,
    data_freshness,
    rows_aggregated,
    pipeline_fresh
   FROM ( SELECT ops_daily.id,
            ops_daily.client_id,
            ops_daily.fecha,
            ops_daily.record_type,
            ops_daily.bucket_start,
            ops_daily.ventas_dia,
            ops_daily.ventas_brutas,
            ops_daily.descuentos,
            ops_daily.devoluciones,
            ops_daily.efectivo,
            ops_daily.tarjeta,
            ops_daily.tickets_count,
            ops_daily.mesas_atendidas,
            ops_daily.personas_restaurant,
            ops_daily.ticket_promedio_restaurant,
            ops_daily.propinas_total,
            ops_daily.meseros,
            ops_daily.platillos_top,
            ops_daily.ventas_por_grupo,
            ops_daily.pago_metodos,
            ops_daily.source_system,
            ops_daily.generated_at,
            ops_daily.data_freshness,
            ops_daily.rows_aggregated,
            true AS pipeline_fresh
           FROM ops_daily
          WHERE (ops_daily.record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text]))
        UNION ALL
         SELECT ops_daily.id,
            ops_daily.client_id,
            ops_daily.fecha,
            ops_daily.record_type,
            ops_daily.bucket_start,
            ops_daily.ventas_dia,
            ops_daily.ventas_brutas,
            ops_daily.descuentos,
            ops_daily.devoluciones,
            ops_daily.efectivo,
            ops_daily.tarjeta,
            ops_daily.tickets_count,
            ops_daily.mesas_atendidas,
            ops_daily.personas_restaurant,
            ops_daily.ticket_promedio_restaurant,
            ops_daily.propinas_total,
            ops_daily.meseros,
            ops_daily.platillos_top,
            ops_daily.ventas_por_grupo,
            ops_daily.pago_metodos,
            ops_daily.source_system,
            ops_daily.generated_at,
            ops_daily.data_freshness,
            ops_daily.rows_aggregated,
            (ops_daily.generated_at > (now() - '00:45:00'::interval)) AS pipeline_fresh
           FROM ops_daily
          WHERE (ops_daily.record_type = 'snapshot'::text)) sub
  WHERE (pipeline_fresh = true)
  ORDER BY client_id, fecha,
        CASE
            WHEN (record_type = 'cierre'::text) THEN 1
            WHEN ((record_type = 'snapshot'::text) AND pipeline_fresh) THEN 2
            WHEN (record_type = 'cierre_wansoft'::text) THEN 3
            ELSE NULL::integer
        END, generated_at DESC NULLS LAST;;

-- ── pos_recipes_canonical ──
CREATE OR REPLACE VIEW pos_recipes_canonical AS
 SELECT v.client_id,
    v.menu_item_id,
    m.name AS menu_item_name,
    l.ingredient_id,
    l.quantity,
    inv.stock_unit,
    l.recipe_unit
   FROM (((pos_recipe_versions v
     JOIN pos_recipe_lines l ON (((l.recipe_version_id = v.id) AND (l.client_id = v.client_id))))
     JOIN pos_menu_items m ON (((m.id = v.menu_item_id) AND (m.client_id = v.client_id))))
     JOIN pos_inventory inv ON (((inv.client_id = v.client_id) AND (inv.ingredient_id = l.ingredient_id))))
  WHERE (v.active = true);;

-- ── reservaciones_activas ──
CREATE OR REPLACE VIEW reservaciones_activas AS
 SELECT id,
    fecha,
    espacio,
    horario_inicio,
    horario_fin,
    status
   FROM amalay_reservaciones
  WHERE (status <> 'cancelled'::text);;

-- ── reservaciones_hoy ──
CREATE OR REPLACE VIEW reservaciones_hoy AS
 SELECT nombre,
    espacio,
    horario_inicio,
    horario_fin,
    guests,
    paquete,
    total,
    status
   FROM amalay_reservaciones
  WHERE ((fecha = CURRENT_DATE) AND (status <> 'cancelled'::text))
  ORDER BY horario_inicio;;

-- ── reviews_pending ──
CREATE OR REPLACE VIEW reviews_pending AS
 SELECT id,
    review_id,
    author,
    rating,
    text,
    date,
    status,
    draft_response,
    published_response,
    location_id,
    created_at,
    updated_at
   FROM reviews
  WHERE (status = ANY (ARRAY['pending'::text, 'draft'::text]))
  ORDER BY date DESC NULLS LAST;;

