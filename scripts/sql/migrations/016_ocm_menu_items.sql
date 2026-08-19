-- ─────────────────────────────────────────────────────────────────────────────
-- 016 · OCM — ocm_menu_items (top platillos vivos, para el chat/IA)
-- Complementa 015 (grupos) con el detalle por platillo. Reemplaza el jsonb
-- platillos_top de wansoft_daily. Agrega pos_orders.items en vivo, cualquier tenant.
-- Validado read-only contra prod. Aplicar en prod = el fundador.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ocm_menu_items AS
SELECT o.client_id, (o.created_at AT TIME ZONE 'America/Monterrey')::date AS fecha,
  (it->>'nombre') AS platillo,
  SUM(COALESCE((it->>'cantidad')::numeric,0))::integer AS cantidad,
  ROUND(SUM((it->>'subtotal')::numeric),2) AS ventas
FROM public.pos_orders o
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END
) AS it
WHERE o.status IN ('cerrada','completada') AND (it->>'nombre') IS NOT NULL
GROUP BY o.client_id, (o.created_at AT TIME ZONE 'America/Monterrey')::date, (it->>'nombre');
