-- ─────────────────────────────────────────────────────────────────────────────
-- 015 · OCM Fase 2 — vistas vivas de meseros y grupos de menú
-- Ver docs/platform/OCM-REVIEW-2026-08-19.md
--
-- Reemplazan las fuentes muertas/solo-AMALAY que usaba la IA:
--   • ocm_waiter_rankings  ← reemplaza `wansoft_waiter_categories` (que NO tiene
--     columna de cliente → era solo-AMALAY). Agrega pos_orders por mesero.
--   • ocm_menu_groups      ← reemplaza `ventas_por_grupo` (jsonb en wansoft_daily).
--     Explota pos_orders.items y joinea al catálogo para el nombre del grupo.
--
-- Vivas para CUALQUIER tenant (agregan pos_orders directo). Validadas: creadas en
-- staging + lógica corrida read-only contra prod (AMALAY) → meseros y grupos reales.
-- Aplicar en prod = el fundador (MCP prod es read-only).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.ocm_waiter_rankings AS
SELECT
  o.client_id,
  (o.created_at AT TIME ZONE 'America/Monterrey')::date AS fecha,
  o.mesero,
  SUM(o.total)                                  AS ventas,
  COUNT(*)::integer                             AS tickets,
  SUM(COALESCE(o.personas,0))::integer          AS personas,
  ROUND(SUM(o.total)/NULLIF(COUNT(*),0),2)      AS ticket_promedio,
  SUM(COALESCE(o.propina,0))                    AS propinas
FROM public.pos_orders o
WHERE o.status IN ('cerrada','completada') AND o.mesero IS NOT NULL AND o.mesero <> ''
GROUP BY o.client_id, (o.created_at AT TIME ZONE 'America/Monterrey')::date, o.mesero;

CREATE OR REPLACE VIEW public.ocm_menu_groups AS
SELECT
  o.client_id,
  (o.created_at AT TIME ZONE 'America/Monterrey')::date AS fecha,
  COALESCE(c.name, mi.category_id, 'Sin grupo')  AS grupo,
  ROUND(SUM((it->>'subtotal')::numeric),2)       AS ventas,
  SUM(COALESCE((it->>'cantidad')::numeric,0))::integer AS cantidad
FROM public.pos_orders o
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END
) AS it
LEFT JOIN public.pos_menu_items mi ON mi.id = (it->>'menuItemId') AND mi.client_id = o.client_id
LEFT JOIN public.pos_menu_categories c ON c.id = mi.category_id AND c.client_id = o.client_id
WHERE o.status IN ('cerrada','completada')
GROUP BY o.client_id, (o.created_at AT TIME ZONE 'America/Monterrey')::date, COALESCE(c.name, mi.category_id, 'Sin grupo');
